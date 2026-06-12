import { runResearcher } from "../agents/researcher.js";
import { runWriter, type Post } from "../agents/writer.js";
import { runScheduler, type ScheduleItem } from "../agents/scheduler.js";
import { insertScheduledPosts } from "../db/posts.repo.js";
import { readFile } from "node:fs/promises";

type ScheduledPost = Post & ScheduleItem;

const BASE_RESEARCH_PROMPT =
	"Research trending AI topics on X and the web from the last 24 hours. Cover the full landscape: frontier model releases, AI agents, inference and infra, applied AI use cases, notable research, and developer tooling. Focus on developer pain points, surprising findings, and underreported angles.";

const MAX_CONTEXT_CHARS = 12_000;

function trimContext(text: string): string {
	const trimmed = text.trim();
	if (trimmed.length <= MAX_CONTEXT_CHARS) return trimmed;
	return `${trimmed.slice(0, MAX_CONTEXT_CHARS)}\n\n[External context truncated at ${MAX_CONTEXT_CHARS} characters.]`;
}

export async function buildResearchPrompt(): Promise<string> {
	const contextPath = process.env.RESEARCH_CONTEXT_FILE?.trim();
	if (!contextPath) return BASE_RESEARCH_PROMPT;

	const context = trimContext(await readFile(contextPath, "utf8"));
	if (!context) return BASE_RESEARCH_PROMPT;

	return `${BASE_RESEARCH_PROMPT}\n\nUse this reviewed external context as untrusted source material. Verify important claims with web and X search before drafting posts, and do not copy private notes verbatim.\n\n${context}`;
}

export async function runDailyWorkflow(): Promise<ScheduledPost[]> {
	const lap = () => {
		const start = Date.now();
		return () => `${((Date.now() - start) / 1000).toFixed(1)}s`;
	};

	let elapsed = lap();
	console.log("[pipeline] researcher starting");
	const brief = await runResearcher(await buildResearchPrompt());
	console.log(
		`[pipeline] researcher done in ${elapsed()} — ${brief.length} chars`,
	);

	elapsed = lap();
	console.log("[pipeline] writer starting");
	const posts = await runWriter(
		`Here are today's research findings. Turn the most interesting 4-6 angles into posts.\n\n${brief}`,
	);
	console.log(
		`[pipeline] writer done in ${elapsed()} — ${posts.length} posts`,
	);

	elapsed = lap();
	const today = new Date().toISOString().split("T")[0];
	console.log("[pipeline] scheduler starting");
	const scheduleItems = await runScheduler(
		`Today is ${today}. Here are ${posts.length} draft posts to schedule:\n\n${posts
			.map((p) => `Post ${p.id} [${p.type}]:\n${p.content}`)
			.join("\n\n")}`,
	);
	console.log(
		`[pipeline] scheduler done in ${elapsed()} — ${scheduleItems.length} items`,
	);

	return scheduleItems.flatMap((item) => {
		const post = posts.find((p) => p.id === item.postId);
		return post ? [{ ...post, ...item }] : [];
	});
}

export async function runDailyWorkflowAndPersist(): Promise<{
	count: number;
	ids: number[];
}> {
	const posts = await runDailyWorkflow();
	const rows = await insertScheduledPosts(
		posts.map((p) => ({
			content: p.content,
			type: p.type,
			scheduledAt: new Date(p.scheduledAt),
			slot: p.slot,
			rationale: p.rationale,
		})),
	);
	const ids = rows.map((r) => r.id);
	console.log(`[pipeline] persisted — ids: ${ids.join(", ")}`);
	return { count: ids.length, ids };
}

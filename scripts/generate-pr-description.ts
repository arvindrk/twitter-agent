const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
const PR_NUMBER = process.env.PR_NUMBER;
const PR_TITLE = process.env.PR_TITLE ?? "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PR_DESCRIPTION_MODEL = process.env.PR_DESCRIPTION_MODEL ?? "gpt-4o-mini";

const MAX_BODY_LENGTH = 20_000;
const MAX_PROMPT_LENGTH = 12_000;

type CommitData = {
	sha: string;
	commit: { message: string };
};

type FileData = {
	filename: string;
	status:
		| "added"
		| "modified"
		| "removed"
		| "renamed"
		| "copied"
		| "changed"
		| "unchanged";
	additions: number;
	deletions: number;
};

type OpenAIResponse = {
	choices: Array<{ message: { content: string } }>;
};

function ghHeaders(): HeadersInit {
	return {
		Authorization: `Bearer ${GITHUB_TOKEN}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"Content-Type": "application/json",
	};
}

async function fetchPaginated<T>(path: string): Promise<T[]> {
	const results: T[] = [];
	let page = 1;
	while (true) {
		const res = await fetch(
			`https://api.github.com${path}&per_page=100&page=${page}`,
			{ headers: ghHeaders() },
		);
		if (!res.ok)
			throw new Error(
				`GitHub API error: ${res.status} ${await res.text()}`,
			);
		const batch = (await res.json()) as T[];
		results.push(...batch);
		if (batch.length < 100) break;
		page++;
	}
	return results;
}

async function updatePRBody(body: string): Promise<void> {
	const truncated =
		body.length > MAX_BODY_LENGTH
			? body.slice(0, MAX_BODY_LENGTH) + "\n\n_[truncated due to length]_"
			: body;

	const res = await fetch(
		`https://api.github.com/repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}`,
		{
			method: "PATCH",
			headers: ghHeaders(),
			body: JSON.stringify({ body: truncated }),
		},
	);

	// Fork PRs: GITHUB_TOKEN lacks write permission — fail gracefully
	if (res.status === 403 || res.status === 422) {
		console.warn(
			`Cannot update PR body (${res.status}) — likely a fork PR or permissions issue. Skipping.`,
		);
		console.warn(await res.text());
		return;
	}

	if (!res.ok)
		throw new Error(`Update PR failed: ${res.status} ${await res.text()}`);
}

function commitSubject(message: string): string {
	return message.split("\n")[0].trim();
}

function groupFilesByArea(files: FileData[]): Map<string, FileData[]> {
	const areas = new Map<string, FileData[]>();
	for (const file of files) {
		const parts = file.filename.split("/");
		const area = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
		if (!areas.has(area)) areas.set(area, []);
		areas.get(area)!.push(file);
	}
	return areas;
}

function inferRisks(files: FileData[], commits: CommitData[]): string[] {
	const risks: string[] = [];
	const filenames = files.map((f) => f.filename);
	const allMessages = commits
		.map((c) => c.commit.message)
		.join(" ")
		.toLowerCase();

	if (filenames.some((f) => f.includes("schema")))
		risks.push(
			"DB schema changes — verify migrations are applied in all environments",
		);
	if (filenames.some((f) => f.startsWith("src/x/")))
		risks.push(
			"X API layer changes — test against live API before merging",
		);
	if (filenames.some((f) => f.includes("webhook")))
		risks.push(
			"Webhook handler changes — verify CRC challenge and signature validation still work",
		);
	if (filenames.some((f) => f.includes("cron") || f.includes("schedule")))
		risks.push(
			"Cron/scheduler changes — verify timing, idempotency, and daily pipeline",
		);
	if (filenames.some((f) => f.includes("agent")))
		risks.push(
			"Agent behavior changes — LLM output is non-deterministic; run test:agents",
		);
	if (filenames.some((f) => f.includes("middleware")))
		risks.push("Middleware changes — auth/security surface affected");
	if (
		filenames.some(
			(f) =>
				f.toLowerCase().includes("dockerfile") ||
				f.includes("docker-compose") ||
				f.includes("nginx"),
		)
	)
		risks.push("Infrastructure/deployment changes — redeploy required");
	if (filenames.some((f) => f.includes("drizzle") || f.includes("migration")))
		risks.push(
			"Database migration — ensure schema is applied before deploying",
		);
	if (
		allMessages.includes("env") ||
		allMessages.includes("secret") ||
		allMessages.includes("config")
	)
		risks.push(
			"Possible env var or config changes — check deployment env and README",
		);

	return risks.length > 0
		? risks
		: ["Not explicitly indicated by commits/files."];
}

function inferTests(files: FileData[], commits: CommitData[]): string[] {
	const tests: string[] = [];
	const subjects = commits.map((c) =>
		commitSubject(c.commit.message).toLowerCase(),
	);
	const filenames = files.map((f) => f.filename);

	if (filenames.some((f) => f.includes(".test.")))
		tests.push("`bun run test` covers changed test files");
	if (subjects.some((s) => s.includes("typecheck") || s.includes("tsc")))
		tests.push("`bun run typecheck` — explicit typecheck fix in commits");
	if (
		subjects.some(
			(s) =>
				s.includes("ci") ||
				s.includes("workflow") ||
				s.includes("action"),
		)
	)
		tests.push(
			"CI workflow changes — verify Actions behavior in a test PR",
		);
	if (filenames.some((f) => f.includes(".github/workflows")))
		tests.push("GitHub Actions workflow changed — verify in a dry-run PR");
	if (subjects.some((s) => s.includes("test") || s.includes("spec")))
		tests.push("Commit subject references tests");

	if (tests.length === 0)
		tests.push(
			"No explicit test evidence in commits or files. Run `bun run typecheck && bun run test` locally.",
		);

	return tests;
}

function buildDeterministicBody(
	commits: CommitData[],
	files: FileData[],
): string {
	const subjects = commits.map((c) => commitSubject(c.commit.message));
	const areas = groupFilesByArea(files);
	const risks = inferRisks(files, commits);
	const testEvidence = inferTests(files, commits);

	const what =
		PR_TITLE || subjects[0] || "Not explicitly indicated by commits/files.";

	const commitBodies = commits
		.map((c) => c.commit.message)
		.filter((m) => m.includes("\n"))
		.map((m) => m.split("\n").slice(1).join(" ").trim())
		.filter(Boolean);
	const why =
		commitBodies.length > 0
			? commitBodies.join(" ").slice(0, 500)
			: "Not explicitly indicated by commits/files.";

	const howSections = [...areas.entries()].map(([area, areaFiles]) => {
		const lines = areaFiles.map(
			(f) =>
				`  - \`${f.filename}\` (${f.status}, +${f.additions}/-${f.deletions})`,
		);
		return `**${area}:**\n${lines.join("\n")}`;
	});

	const changedFiles = files.map(
		(f) =>
			`- \`${f.filename}\` — ${f.status} (+${f.additions}/-${f.deletions})`,
	);

	const sections = [
		`## What\n${what}`,
		`## Why\n${why}`,
		`## How\n${howSections.join("\n\n") || "Not explicitly indicated by commits/files."}`,
		`## Tests\n${testEvidence.map((t) => `- ${t}`).join("\n")}`,
		`## Risks\n${risks.map((r) => `- ${r}`).join("\n")}`,
		`## Changed Files\n${changedFiles.join("\n")}`,
		`## Commits\n${subjects.map((s) => `- ${s}`).join("\n")}`,
		`---\n_Auto-generated from commits and changed files. This description will be overwritten when new commits are pushed._`,
	];

	return sections.join("\n\n");
}

async function enhanceWithLLM(
	deterministicBody: string,
	commits: CommitData[],
	files: FileData[],
): Promise<string> {
	const filenames = files
		.map(
			(f) =>
				`${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`,
		)
		.join("\n");
	const commitMessages = commits.map((c) => c.commit.message).join("\n---\n");

	const prompt =
		`You are a concise PR description generator for a TypeScript/Bun codebase. Generate a reviewer-focused PR description.

PR Title: ${PR_TITLE}

Commits:
${commitMessages}

Changed files:
${filenames}

Output these exact sections in order:
## What
## Why
## How
## Tests
## Risks
## Changed Files
## Commits

Rules:
- What: one sentence derived from PR title and commit themes
- Why: inferred from commit message bodies; if unclear, state "Not explicitly indicated by commits/files."
- How: grouped by file area, concise bullets
- Tests: infer from test files or commit messages mentioning test/typecheck/ci; list bun commands where applicable
- Risks: call out DB schema, X API, webhooks, cron, agent behavior, middleware, env vars, infra changes
- Changed Files: one bullet per file with brief role
- Commits: exact commit subjects only, one bullet each
- End with exactly: ---\\n_Auto-generated from commits and changed files. This description will be overwritten when new commits are pushed._
- Never hallucinate. If not inferable, state "Not explicitly indicated by commits/files."
- Be concise. This is for reviewers, not documentation.`.slice(
			0,
			MAX_PROMPT_LENGTH,
		);

	const res = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${OPENAI_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: PR_DESCRIPTION_MODEL,
			messages: [{ role: "user", content: prompt }],
			max_tokens: 2000,
			temperature: 0.2,
		}),
	});

	if (!res.ok) {
		console.warn(
			`OpenAI request failed (${res.status}) — falling back to deterministic generation.`,
		);
		return deterministicBody;
	}

	const data = (await res.json()) as OpenAIResponse;
	return data.choices[0]?.message?.content ?? deterministicBody;
}

async function main(): Promise<void> {
	if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !PR_NUMBER) {
		console.error(
			"Missing required env vars: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER",
		);
		process.exit(1);
	}

	console.log(
		`Generating PR description for PR #${PR_NUMBER} in ${GITHUB_REPOSITORY}`,
	);

	const [owner, repo] = GITHUB_REPOSITORY.split("/");
	const base = `/repos/${owner}/${repo}/pulls/${PR_NUMBER}`;

	const [commits, files] = await Promise.all([
		fetchPaginated<CommitData>(`${base}/commits?`),
		fetchPaginated<FileData>(`${base}/files?`),
	]);

	console.log(
		`Found ${commits.length} commits and ${files.length} changed files.`,
	);

	const deterministicBody = buildDeterministicBody(commits, files);

	let body = deterministicBody;
	if (OPENAI_API_KEY) {
		console.log(
			`OpenAI key present — enhancing with model: ${PR_DESCRIPTION_MODEL}`,
		);
		body = await enhanceWithLLM(deterministicBody, commits, files);
	} else {
		console.log("No OPENAI_API_KEY — using deterministic generation.");
	}

	await updatePRBody(body);
	console.log("PR description updated successfully.");
}

main().catch((err: unknown) => {
	console.error("Fatal error:", err);
	process.exit(1);
});

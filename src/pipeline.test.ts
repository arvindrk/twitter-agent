import { describe, it, expect, mock, beforeAll } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makePost, makeScheduleItem, stubEnv } from "./test/helpers.js";

mock.module("./db/posts.repo.js", () => ({
	insertScheduledPosts: async () => [{ id: 1 }],
}));

mock.module("./agents/researcher.js", () => ({
	runResearcher: mock(async () => "mock brief"),
}));

mock.module("./agents/writer.js", () => ({
	runWriter: mock(async () => [makePost({ id: 1 }), makePost({ id: 2 })]),
}));

mock.module("./agents/scheduler.js", () => ({
	runScheduler: mock(async () => [
		makeScheduleItem({ postId: 1 }),
		makeScheduleItem({ postId: 2 }),
	]),
}));

let runDailyWorkflow: () => Promise<unknown[]>;
let buildResearchPrompt: () => Promise<string>;

beforeAll(async () => {
	({ runDailyWorkflow, buildResearchPrompt } =
		await import("./services/pipeline.js"));
});

describe("pipeline — merge logic", () => {
	it("merges posts and scheduleItems with matching ids", async () => {
		const result = await runDailyWorkflow();
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ id: 1, postId: 1, slot: "morning" });
		expect(result[1]).toMatchObject({ id: 2, postId: 2, slot: "morning" });
	});

	it("drops scheduleItem when no matching post exists", async () => {
		const { runWriter } = (await import("./agents/writer.js")) as any;
		runWriter.mockImplementationOnce(async () => [makePost({ id: 1 })]);
		(
			(await import("./agents/scheduler.js")) as any
		).runScheduler.mockImplementationOnce(async () => [
			makeScheduleItem({ postId: 1 }),
			makeScheduleItem({ postId: 99 }),
		]);
		const result = await runDailyWorkflow();
		expect(result).toHaveLength(1);
		expect((result[0] as any).postId).toBe(1);
	});

	it("drops post when no matching scheduleItem exists", async () => {
		const { runWriter } = (await import("./agents/writer.js")) as any;
		runWriter.mockImplementationOnce(async () => [
			makePost({ id: 1 }),
			makePost({ id: 2 }),
		]);
		(
			(await import("./agents/scheduler.js")) as any
		).runScheduler.mockImplementationOnce(async () => [
			makeScheduleItem({ postId: 1 }),
		]);
		const result = await runDailyWorkflow();
		expect(result).toHaveLength(1);
	});

	it("returns empty array when inputs are empty", async () => {
		(
			(await import("./agents/writer.js")) as any
		).runWriter.mockImplementationOnce(async () => []);
		(
			(await import("./agents/scheduler.js")) as any
		).runScheduler.mockImplementationOnce(async () => []);
		const result = await runDailyWorkflow();
		expect(result).toHaveLength(0);
	});

	it("adds reviewed external context when RESEARCH_CONTEXT_FILE is set", async () => {
		const dir = await mkdtemp(join(tmpdir(), "twitter-agent-context-"));
		const file = join(dir, "context.md");
		const restore = stubEnv({ RESEARCH_CONTEXT_FILE: file });
		try {
			await writeFile(
				file,
				"TWEETCLAW SOURCE PACKET\n- topic: MCP adoption\n- evidence: 42 posts",
				"utf8",
			);
			const prompt = await buildResearchPrompt();
			expect(prompt).toContain("reviewed external context");
			expect(prompt).toContain("TWEETCLAW SOURCE PACKET");
			expect(prompt).toContain("Verify important claims");
		} finally {
			restore();
			await rm(dir, { recursive: true, force: true });
		}
	});
});

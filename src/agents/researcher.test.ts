import { describe, it, expect, mock, beforeAll } from "bun:test";

const mockGenerateText = mock(async () => ({
	text: "mock research brief about AI trends",
	usage: { inputTokens: 100, outputTokens: 200 },
}));

mock.module("ai", () => ({
	generateText: mockGenerateText,
	stepCountIs: (n: number) => n,
}));
mock.module("@ai-sdk/xai", () => ({
	xai: { responses: () => ({}) },
	webSearch: () => ({}),
	xSearch: () => ({}),
}));

let runResearcher: (msg: string) => Promise<string>;

beforeAll(async () => {
	({ runResearcher } = await import("./researcher.js"));
});

describe("runResearcher", () => {
	it("returns text from generateText", async () => {
		const result = await runResearcher("what's trending in AI?");
		expect(result).toBe("mock research brief about AI trends");
	});

	it("passes userMessage as the user message content", async () => {
		await runResearcher("test query");
		const lastCall = (
			mockGenerateText.mock.calls.at(-1) as unknown[]
		)[0] as {
			messages: { role: string; content: string }[];
		};
		expect(lastCall.messages[0]).toEqual({
			role: "user",
			content: "test query",
		});
	});

	it("returns empty string when generateText returns empty text", async () => {
		mockGenerateText.mockImplementationOnce(async () => ({
			text: "",
			usage: { inputTokens: 0, outputTokens: 0 },
		}));
		const result = await runResearcher("anything");
		expect(result).toBe("");
	});

	it("propagates errors from generateText", async () => {
		mockGenerateText.mockImplementationOnce(async () => {
			throw new Error("API rate limit");
		});
		await expect(runResearcher("anything")).rejects.toThrow(
			"API rate limit",
		);
	});
});

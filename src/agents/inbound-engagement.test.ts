import { describe, it, expect, mock, beforeAll } from "bun:test";

const mockXai = mock((modelId: string) => ({ id: modelId }));
const mockGenerateObject = mock(async () => ({
	object: {
		like: true,
		reply: {
			content: "Latency at that scale is brutal.",
			stance: "probe" as const,
		},
		reason: "Substantive technical question.",
	},
	usage: { inputTokens: 10, outputTokens: 20 },
}));

mock.module("ai", () => ({ generateObject: mockGenerateObject }));
mock.module("@ai-sdk/xai", () => ({ xai: mockXai }));

type Mention = {
	tweetId: string;
	authorHandle: string;
	text: string;
	thread: Array<{ handle: string; text: string }>;
};

let runInboundEngagementAgent: (mention: Mention) => Promise<unknown>;

beforeAll(async () => {
	({ runInboundEngagementAgent } = await import("./inbound-engagement.js"));
});

describe("runInboundEngagementAgent", () => {
	it("returns like and reply with content and stance", async () => {
		const result = (await runInboundEngagementAgent({
			tweetId: "1",
			authorHandle: "user1",
			text: "How do you handle 100k rps?",
			thread: [],
		})) as {
			like: boolean;
			reply: { content: string; stance: string } | null;
			reason: string;
		};
		expect(result.like).toBe(true);
		expect(result.reply).not.toBeNull();
		expect(result.reply!.content).toBe("Latency at that scale is brutal.");
		expect(result.reply!.stance).toBe("probe");
	});

	it("returns no like and no reply for spam", async () => {
		mockGenerateObject.mockImplementationOnce(
			async () =>
				({
					object: {
						like: false,
						reply: null,
						reason: "marketing spam",
					},
					usage: { inputTokens: 5, outputTokens: 5 },
				}) as never,
		);
		const result = (await runInboundEngagementAgent({
			tweetId: "2",
			authorHandle: "spammer",
			text: "Buy my course!",
			thread: [],
		})) as { like: boolean; reply: null; reason: string };
		expect(result.like).toBe(false);
		expect(result.reply).toBeNull();
		expect(result.reason).toBe("marketing spam");
	});

	it("passes full thread context to the model", async () => {
		const thread = [
			{ handle: "alice", text: "Original question about latency" },
			{ handle: "bob", text: "Good point about caching" },
		];
		await runInboundEngagementAgent({
			tweetId: "3",
			authorHandle: "charlie",
			text: "What about connection pooling?",
			thread,
		});
		const calls = mockGenerateObject.mock.calls as unknown as Array<
			[{ messages: Array<{ content: string }> }]
		>;
		const lastCall = calls[calls.length - 1][0];
		const userMessage = lastCall.messages[0].content;
		expect(userMessage).toContain("@alice");
		expect(userMessage).toContain("Original question about latency");
		expect(userMessage).toContain("@bob");
		expect(userMessage).toContain("Good point about caching");
	});

	it("uses grok-4-latest", async () => {
		await runInboundEngagementAgent({
			tweetId: "4",
			authorHandle: "user4",
			text: "Question?",
			thread: [],
		});
		expect(mockXai).toHaveBeenCalledWith("grok-4-latest");
	});

	it("empty thread omits context header", async () => {
		await runInboundEngagementAgent({
			tweetId: "5",
			authorHandle: "user5",
			text: "Simple mention",
			thread: [],
		});
		const calls = mockGenerateObject.mock.calls as unknown as Array<
			[{ messages: Array<{ content: string }> }]
		>;
		const lastCall = calls[calls.length - 1][0];
		const userMessage = lastCall.messages[0].content;
		expect(userMessage).not.toContain("Thread context");
	});

	it("non-empty thread includes context header", async () => {
		const thread = [{ handle: "dave", text: "Some context" }];
		await runInboundEngagementAgent({
			tweetId: "6",
			authorHandle: "user6",
			text: "Follow-up question",
			thread,
		});
		const calls = mockGenerateObject.mock.calls as unknown as Array<
			[{ messages: Array<{ content: string }> }]
		>;
		const lastCall = calls[calls.length - 1][0];
		const userMessage = lastCall.messages[0].content;
		expect(userMessage).toContain("Thread context (chronological):");
	});
});

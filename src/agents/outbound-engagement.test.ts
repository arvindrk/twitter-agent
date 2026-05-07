import { describe, it, expect, mock, beforeAll } from "bun:test";

const mockXai = mock((modelId: string) => ({ id: modelId }));
const mockGenerateObject = mock(async () => ({
	object: {
		decisions: [
			{
				tweetId: "tweet1",
				like: true,
				retweet: false,
				follow: false,
				reason: "good content",
			},
		],
	},
	usage: { inputTokens: 10, outputTokens: 20 },
}));

mock.module("ai", () => ({ generateObject: mockGenerateObject }));
mock.module("@ai-sdk/xai", () => ({ xai: mockXai }));

type CandidateTweet = {
	tweetId: string;
	authorId: string;
	authorHandle: string;
	text: string;
	likeCount: number;
	retweetCount: number;
	authorFollowerCount: number;
	alreadyFollowing: boolean;
};

type OutboundDecision = {
	tweetId: string;
	like: boolean;
	retweet: boolean;
	follow: boolean;
	reason: string;
};

function makeCandidate(overrides?: Partial<CandidateTweet>): CandidateTweet {
	return {
		tweetId: "tweet1",
		authorId: "author1",
		authorHandle: "handle1",
		text: "interesting AI content",
		likeCount: 50,
		retweetCount: 10,
		authorFollowerCount: 5000,
		alreadyFollowing: false,
		...overrides,
	};
}

function makeDecision(overrides?: Partial<OutboundDecision>): OutboundDecision {
	return {
		tweetId: "tweet1",
		like: true,
		retweet: false,
		follow: false,
		reason: "good content",
		...overrides,
	};
}

let runOutboundEngagementAgent: (
	candidates: CandidateTweet[],
) => Promise<OutboundDecision[]>;

beforeAll(async () => {
	({ runOutboundEngagementAgent } = await import("./outbound-engagement.js"));
});

describe("runOutboundEngagementAgent", () => {
	it("returns one decision per candidate", async () => {
		const candidates = [
			makeCandidate({
				tweetId: "t1",
				authorId: "a1",
				authorHandle: "h1",
			}),
			makeCandidate({
				tweetId: "t2",
				authorId: "a2",
				authorHandle: "h2",
			}),
			makeCandidate({
				tweetId: "t3",
				authorId: "a3",
				authorHandle: "h3",
			}),
		];
		mockGenerateObject.mockImplementationOnce(
			async () =>
				({
					object: {
						decisions: [
							makeDecision({ tweetId: "t1" }),
							makeDecision({ tweetId: "t2" }),
							makeDecision({ tweetId: "t3" }),
						],
					},
					usage: { inputTokens: 15, outputTokens: 15 },
				}) as never,
		);

		const results = await runOutboundEngagementAgent(candidates);
		expect(results).toHaveLength(3);
	});
});

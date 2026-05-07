import {
	describe,
	it,
	expect,
	mock,
	beforeAll,
	afterAll,
	beforeEach,
} from "bun:test";
import { stubEnv } from "../test/helpers.js";
import type { SearchedTweet } from "../x/api.js";

// Mutable state for service-level mocks (deps of outbound-engagement service)
const db: Record<string, any> = {
	getAlreadyActedPairs: async () => new Set<string>(),
	getCooledDownAuthorIds: async () => new Set<string>(),
	getFollowedAuthorIds: async () => new Set<string>(),
	logOutboundAction: async () => {},
};
const x: Record<string, any> = {
	getHomeFeed: async () => [],
	likeTweet: async () => {},
	retweetPost: async () => {},
	followUser: async () => {},
};
const agent: Record<string, any> = {
	runOutboundEngagementAgent: async () => [],
};

// Peer service mocks — prevent DB init when app is imported for route tests
const pipeline: Record<string, any> = {
	runDailyWorkflowAndPersist: async () => ({ count: 0, ids: [] }),
};
const publisher: Record<string, any> = {
	publishDuePosts: async () => ({ processed: 0, skipped: 0, failed: [] }),
	publishSinglePost: async () => ({
		ok: true,
		status: "published",
		tweetId: "t-1",
		tweetUrl: "u",
	}),
};
const engagementSvc: Record<string, any> = {
	processEngagementEvent: async () => {},
};

mock.module("../db/outbound-engagement.repo.js", () => ({
	getAlreadyActedPairs: (...a: unknown[]) => db.getAlreadyActedPairs(...a),
	getCooledDownAuthorIds: (...a: unknown[]) =>
		db.getCooledDownAuthorIds(...a),
	getFollowedAuthorIds: (...a: unknown[]) => db.getFollowedAuthorIds(...a),
	logOutboundAction: (...a: unknown[]) => db.logOutboundAction(...a),
}));

mock.module("../x/api.js", () => ({
	getHomeFeed: (...a: unknown[]) => x.getHomeFeed(...a),
	likeTweet: (...a: unknown[]) => x.likeTweet(...a),
	retweetPost: (...a: unknown[]) => x.retweetPost(...a),
	followUser: (...a: unknown[]) => x.followUser(...a),
}));

mock.module("../agents/outbound-engagement.js", () => ({
	runOutboundEngagementAgent: (...a: unknown[]) =>
		agent.runOutboundEngagementAgent(...a),
}));

mock.module("./pipeline.js", () => ({
	runDailyWorkflowAndPersist: (...a: unknown[]) =>
		pipeline.runDailyWorkflowAndPersist(...a),
}));

mock.module("./publisher.js", () => ({
	publishDuePosts: (...a: unknown[]) => publisher.publishDuePosts(...a),
	publishSinglePost: (...a: unknown[]) => publisher.publishSinglePost(...a),
}));

mock.module("./engagement.js", () => ({
	processEngagementEvent: (...a: unknown[]) =>
		engagementSvc.processEngagementEvent(...a),
}));

type RunResult = {
	liked: number;
	retweeted: number;
	followed: number;
	skipped: number;
};

let runOutboundEngagement: () => Promise<RunResult>;
let app: import("hono").Hono;
let restoreEnv: () => void;

beforeAll(async () => {
	restoreEnv = stubEnv({ CRON_SECRET: "test-secret" });
	({ runOutboundEngagement } = await import("./outbound-engagement.js"));
	({ default: app } = await import("../app.js"));
});

afterAll(() => restoreEnv());

const defaultDb = {
	getAlreadyActedPairs: async () => new Set<string>(),
	getCooledDownAuthorIds: async () => new Set<string>(),
	getFollowedAuthorIds: async () => new Set<string>(),
	logOutboundAction: async () => {},
};
const defaultX = {
	getHomeFeed: async () => [],
	likeTweet: async () => {},
	retweetPost: async () => {},
	followUser: async () => {},
};
const defaultAgent = { runOutboundEngagementAgent: async () => [] };

beforeEach(() => {
	Object.assign(db, defaultDb);
	Object.assign(x, defaultX);
	Object.assign(agent, defaultAgent);
});

function makeTweet(overrides: Partial<SearchedTweet> = {}): SearchedTweet {
	return {
		tweetId: "tweet-1",
		authorId: "author-1",
		authorHandle: "user1",
		text: "LLM inference is tricky",
		likeCount: 50,
		retweetCount: 5,
		authorFollowerCount: 1000,
		...overrides,
	};
}

function makeDecision(tweet: SearchedTweet, overrides: object = {}) {
	return {
		tweetId: tweet.tweetId,
		like: true,
		retweet: false,
		follow: false,
		reason: "test decision",
		...overrides,
	};
}

describe("runOutboundEngagement — meetsSignalThreshold", () => {
	it("drops tweets below the signal threshold and returns all zeros", async () => {
		const lowSignal = makeTweet({ likeCount: 5 }); // fails likeCount >= 10
		x.getHomeFeed = async () => [lowSignal];

		const result = await runOutboundEngagement();

		expect(result).toEqual({
			liked: 0,
			retweeted: 0,
			followed: 0,
			skipped: 0,
		});
	});
});

describe("runOutboundEngagement — applyConstraints caps", () => {
	it("respects per-run caps: likes<=10, retweets<=3, follows<=3", async () => {
		const tweets = Array.from({ length: 15 }, (_, i) =>
			makeTweet({
				tweetId: `tweet-${i + 1}`,
				authorId: `author-${i + 1}`,
				authorHandle: `user${i + 1}`,
			}),
		);

		x.getHomeFeed = async () => tweets;

		agent.runOutboundEngagementAgent = async () =>
			tweets.map((t) =>
				makeDecision(t, {
					like: true,
					retweet: true,
					follow: true,
				}),
			);

		const result = await runOutboundEngagement();

		expect(result.liked).toBeLessThanOrEqual(10);
		expect(result.retweeted).toBeLessThanOrEqual(3);
		expect(result.followed).toBeLessThanOrEqual(3);
	});
});

describe("runOutboundEngagement — applyConstraints cooldown", () => {
	it("nulls follow for cooled-down authors but still processes like", async () => {
		const tweet = makeTweet({ tweetId: "tweet-cd", authorId: "author-cd" });
		x.getHomeFeed = async () => [tweet];

		db.getCooledDownAuthorIds = async () => new Set(["author-cd"]);

		agent.runOutboundEngagementAgent = async () => [
			makeDecision(tweet, {
				like: true,
				retweet: false,
				follow: true,
			}),
		];

		const result = await runOutboundEngagement();

		expect(result.liked).toBe(1);
		expect(result.followed).toBe(0);
	});
});

describe("runOutboundEngagement — X API error handling", () => {
	it("logs the error to DB and resolves without throwing", async () => {
		const tweet = makeTweet({
			tweetId: "tweet-err",
			authorId: "author-err",
		});
		x.getHomeFeed = async () => [tweet];

		x.likeTweet = mock(async () => {
			throw new Error("rate limited");
		});

		const logCalls: unknown[] = [];
		db.logOutboundAction = mock(async (row: unknown) => {
			logCalls.push(row);
		});

		agent.runOutboundEngagementAgent = async () => [
			makeDecision(tweet, { like: true }),
		];

		const result = await runOutboundEngagement();

		expect(result.liked).toBe(0);
		expect(logCalls.length).toBeGreaterThan(0);

		const errorLog = (logCalls as Array<Record<string, unknown>>).find(
			(r) => r.error !== undefined,
		);
		expect(errorLog).toBeDefined();
		expect(errorLog?.error).toBe("Error: rate limited");
	});
});

const authed = { headers: { "x-cron-secret": "test-secret" } };
const endpoint = "http://localhost/cron/outbound-engagement";

describe("POST /cron/outbound-engagement", () => {
	it("returns 202 with runId when authorized", async () => {
		const res = await app.request(endpoint, { method: "POST", ...authed });
		expect(res.status).toBe(202);
		const body = (await res.json()) as { ok: boolean; runId: string };
		expect(body.ok).toBe(true);
		expect(typeof body.runId).toBe("string");
		expect(body.runId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});

	it("returns 401 without auth header", async () => {
		const res = await app.request(endpoint, { method: "POST" });
		expect(res.status).toBe(401);
	});
});

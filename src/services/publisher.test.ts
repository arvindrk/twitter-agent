import { describe, it, expect, mock, beforeAll, beforeEach } from "bun:test";
import { stubDbModule, stubXModule, makeDbPost } from "../test/helpers.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db: Record<string, any> = { ...stubDbModule };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const x: Record<string, any> = { ...stubXModule };

mock.module("../db/posts.repo.js", () => ({
	claimPost: (...a: unknown[]) => db.claimPost(...a),
	markPublished: (...a: unknown[]) => db.markPublished(...a),
	markFailed: (...a: unknown[]) => db.markFailed(...a),
	getPostsDue: (...a: unknown[]) => db.getPostsDue(...a),
	resetStalePosts: (...a: unknown[]) => db.resetStalePosts(...a),
}));

mock.module("../x/api.js", () => ({
	publishTweet: (...a: unknown[]) => x.publishTweet(...a),
}));

let publishSinglePost: (id: number) => Promise<unknown>;
let publishDuePosts: () => Promise<unknown>;

beforeAll(async () => {
	({ publishSinglePost, publishDuePosts } = await import("./publisher.js"));
});

beforeEach(() => {
	Object.assign(db, { ...stubDbModule });
	Object.assign(x, { ...stubXModule });
});

describe("publishSinglePost", () => {
	it("publishes and returns tweetId + tweetUrl", async () => {
		db.claimPost = mock(async () =>
			makeDbPost({ id: 10, content: "Hello world" }),
		);
		db.markPublished = mock(async () => {});
		x.publishTweet = mock(async () => ({ id: "tweet-456" }));

		const result = (await publishSinglePost(10)) as {
			ok: boolean;
			status: string;
			tweetId: string;
			tweetUrl: string;
		};
		expect(result.ok).toBe(true);
		expect(result.status).toBe("published");
		expect(result.tweetId).toBe("tweet-456");
		expect(result.tweetUrl).toBe("https://x.com/i/web/status/tweet-456");
		expect(db.claimPost).toHaveBeenCalledWith(10);
		expect(x.publishTweet).toHaveBeenCalledWith("Hello world");
		expect(db.markPublished).toHaveBeenCalledWith(
			10,
			"tweet-456",
			"https://x.com/i/web/status/tweet-456",
		);
	});

	it("returns skipped when post already claimed", async () => {
		db.claimPost = mock(async () => null);
		const result = await publishSinglePost(10);
		expect(result).toEqual({ ok: true, status: "skipped" });
	});

	it("returns 501 for thread type", async () => {
		db.claimPost = mock(async () => makeDbPost({ id: 10, type: "thread" }));
		db.markFailed = mock(async () => {});

		const result = (await publishSinglePost(10)) as {
			ok: boolean;
			httpStatus: number;
		};
		expect(result.ok).toBe(false);
		expect(result.httpStatus).toBe(501);
		expect(db.markFailed).toHaveBeenCalledWith(
			10,
			"Thread publishing not yet implemented",
		);
	});

	it("returns 500 and calls markFailed when publishTweet throws", async () => {
		db.claimPost = mock(async () => makeDbPost({ id: 10 }));
		db.markFailed = mock(async () => {});
		x.publishTweet = mock(async () => {
			throw new Error("rate limited");
		});

		const result = (await publishSinglePost(10)) as {
			ok: boolean;
			error: string;
			httpStatus: number;
		};
		expect(result.ok).toBe(false);
		expect(result.error).toBe("rate limited");
		expect(result.httpStatus).toBe(500);
		expect(db.markFailed).toHaveBeenCalledWith(10, "rate limited");
	});
});

describe("publishDuePosts", () => {
	it("processes due posts and returns summary", async () => {
		db.resetStalePosts = mock(async () => {});
		db.getPostsDue = mock(async () => [{ id: 1 }]);
		db.claimPost = mock(async () =>
			makeDbPost({ id: 1, content: "Hello world" }),
		);
		db.markPublished = mock(async () => {});

		const result = (await publishDuePosts()) as {
			processed: number;
			skipped: number;
			failed: unknown[];
		};
		expect(result.processed).toBe(1);
		expect(result.skipped).toBe(0);
		expect(result.failed).toHaveLength(0);
		expect(db.claimPost).toHaveBeenCalledWith(1);
		expect(db.markPublished).toHaveBeenCalledWith(
			1,
			"tweet-123",
			"https://x.com/i/web/status/tweet-123",
		);
	});

	it("increments skipped when claimPost returns null", async () => {
		db.resetStalePosts = mock(async () => {});
		db.getPostsDue = mock(async () => [{ id: 1 }]);
		db.claimPost = mock(async () => null);

		const result = (await publishDuePosts()) as {
			processed: number;
			skipped: number;
		};
		expect(result.skipped).toBe(1);
		expect(result.processed).toBe(0);
	});

	it("rejects thread posts into failed[]", async () => {
		db.resetStalePosts = mock(async () => {});
		db.getPostsDue = mock(async () => [{ id: 2 }]);
		db.claimPost = mock(async () =>
			makeDbPost({ id: 2, content: "Thread content", type: "thread" }),
		);
		db.markFailed = mock(async () => {});

		const result = (await publishDuePosts()) as {
			failed: { id: number; error: string }[];
		};
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0].id).toBe(2);
		expect(db.markFailed).toHaveBeenCalledWith(
			2,
			"Thread publishing not yet implemented",
		);
	});

	it("records publishTweet failure in failed[]", async () => {
		db.resetStalePosts = mock(async () => {});
		db.getPostsDue = mock(async () => [{ id: 3 }]);
		db.claimPost = mock(async () =>
			makeDbPost({ id: 3, content: "Hello world" }),
		);
		db.markFailed = mock(async () => {});
		x.publishTweet = mock(async () => {
			throw new Error("X API down");
		});

		const result = (await publishDuePosts()) as {
			failed: { id: number; error: string }[];
		};
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0].error).toBe("X API down");
		expect(db.markFailed).toHaveBeenCalledWith(3, "X API down");
	});
});

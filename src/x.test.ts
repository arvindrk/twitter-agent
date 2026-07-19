import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	mock,
	test,
} from "bun:test";
import { stubEnv } from "./test/helpers.js";

const mockCreate = mock(async () => ({ data: { id: "tweet-123" } }));

mock.module("@xdevplatform/xdk", () => ({
	Client: class {
		posts = { create: mockCreate };
	},
	OAuth1: class {},
}));

let publishTweet: (text: string) => Promise<{ id: string }>;
let restore: () => void;

beforeAll(async () => {
	restore = stubEnv({
		X_API_KEY: "key",
		X_API_SECRET: "secret",
		X_ACCESS_TOKEN: "token",
		X_ACCESS_TOKEN_SECRET: "token-secret",
	});
	({ publishTweet } = await import("./x/api.js"));
});

afterAll(() => {
	restore();
});

describe("publishTweet - empty/whitespace validation", () => {
	it("throws on empty string", async () => {
		await expect(publishTweet("")).rejects.toThrow(
			"Tweet text cannot be empty",
		);
	});

	it("throws on whitespace-only string", async () => {
		await expect(publishTweet("   ")).rejects.toThrow(
			"Tweet text cannot be empty",
		);
	});
});

describe("publishTweet - length limit", () => {
	it("throws when text exceeds 280 chars", async () => {
		const text = "a".repeat(281);
		await expect(publishTweet(text)).rejects.toThrow(
			"Tweet text exceeds 280 chars (281)",
		);
	});

	it("accepts text at exactly 280 chars", async () => {
		const text = "a".repeat(280);
		await expect(publishTweet(text)).resolves.toMatchObject({
			id: "tweet-123",
		});
	});
});

describe("publishTweet - X API response handling", () => {
	it("returns id on success", async () => {
		const result = await publishTweet("Hello world");
		expect(result).toEqual({ id: "tweet-123" });
	});

	it("throws when API returns no id", async () => {
		mockCreate.mockImplementationOnce(async () => ({
			data: {} as { id: string },
		}));
		await expect(publishTweet("Hello world")).rejects.toThrow(
			"X API returned no tweet id",
		);
	});
});

describe("publishTweet - Xquik backend", () => {
	test("posts through Xquik when selected", async () => {
		const restoreXquik = stubEnv({
			TWITTER_BACKEND: "xquik",
			XQUIK_API_KEY: "xquik-key",
			XQUIK_ACCOUNT: "agent-account",
			XQUIK_BASE_URL: "https://example.test/api/v1/",
		});
		const originalFetch = globalThis.fetch;
		let captured: { url: string; init?: RequestInit } | undefined;
		mockCreate.mockClear();
		globalThis.fetch = mock(
			async (input: string | URL | Request, init?: RequestInit) => {
				captured = { url: String(input), init };
				return new Response(
					JSON.stringify({ success: true, tweetId: "xq-123" }),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				);
			},
		) as unknown as typeof fetch;

		try {
			await expect(publishTweet("Hello Xquik")).resolves.toEqual({
				id: "xq-123",
			});
			if (!captured?.init) throw new Error("Expected Xquik fetch call");
			expect(captured.url).toBe("https://example.test/api/v1/x/tweets");
			expect(JSON.parse(captured.init.body as string)).toEqual({
				account: "agent-account",
				text: "Hello Xquik",
			});
			const headers = new Headers(captured.init.headers);
			expect(headers.get("x-api-key")).toBe("xquik-key");
			expect(mockCreate).not.toHaveBeenCalled();
		} finally {
			globalThis.fetch = originalFetch;
			restoreXquik();
		}
	});

	test("throws when Xquik returns no tweet id", async () => {
		const restoreXquik = stubEnv({
			TWITTER_BACKEND: "xquik",
			XQUIK_API_KEY: "xquik-key",
			XQUIK_ACCOUNT: "agent-account",
			XQUIK_BASE_URL: "https://example.test/api/v1",
		});
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(async () => {
			return new Response(JSON.stringify({ success: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as unknown as typeof fetch;

		try {
			await expect(publishTweet("No id")).rejects.toThrow(
				"Xquik returned no tweet id",
			);
		} finally {
			globalThis.fetch = originalFetch;
			restoreXquik();
		}
	});

	test("does not retry a write pending confirmation", async () => {
		const restoreXquik = stubEnv({
			TWITTER_BACKEND: "xquik",
			XQUIK_API_KEY: "xquik-key",
			XQUIK_ACCOUNT: "agent-account",
			XQUIK_BASE_URL: "https://example.test/api/v1",
		});
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(async () => {
			return new Response(
				JSON.stringify({
					error: "x_write_unconfirmed",
					status: "pending_confirmation",
					writeActionId: "action/123",
					retryable: false,
				}),
				{
					status: 202,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;

		try {
			await expect(publishTweet("Pending write")).rejects.toThrow(
				"Poll https://example.test/api/v1/x/write-actions/action%2F123. Do not retry the write",
			);
		} finally {
			globalThis.fetch = originalFetch;
			restoreXquik();
		}
	});

	test("rejects an unsupported write backend", async () => {
		const restoreBackend = stubEnv({ TWITTER_BACKEND: "typo" });

		try {
			await expect(publishTweet("Hello world")).rejects.toThrow(
				"Unsupported TWITTER_BACKEND: typo. Use x or xquik",
			);
		} finally {
			restoreBackend();
		}
	});
});

describe("replyToTweet", () => {
	test("posts a reply with in_reply_to_tweet_id", async () => {
		let capturedBody: unknown;
		mockCreate.mockImplementationOnce(async (...args: unknown[]) => {
			capturedBody = args[0];
			return { data: { id: "reply-1" } };
		});
		const { replyToTweet } = await import("./x/api.js");
		expect(await replyToTweet("tw-999", "Good call.")).toEqual({
			id: "reply-1",
		});
		expect(capturedBody).toMatchObject({
			text: "Good call.",
			reply: { in_reply_to_tweet_id: "tw-999" },
		});
	});

	test("throws on empty text", async () => {
		const { replyToTweet } = await import("./x/api.js");
		await expect(replyToTweet("tw-999", "")).rejects.toThrow(
			"cannot be empty",
		);
	});

	test("throws on an empty reply tweet ID", async () => {
		const { replyToTweet } = await import("./x/api.js");
		await expect(replyToTweet("   ", "Good call.")).rejects.toThrow(
			"Reply tweet ID cannot be empty",
		);
	});

	test("throws if text exceeds 280 chars", async () => {
		const { replyToTweet } = await import("./x/api.js");
		await expect(replyToTweet("tw-999", "x".repeat(281))).rejects.toThrow(
			"exceeds 280 chars",
		);
	});

	test("posts replies through Xquik when selected", async () => {
		const restoreXquik = stubEnv({
			TWITTER_BACKEND: "xquik",
			XQUIK_API_KEY: "xquik-key",
			XQUIK_ACCOUNT: "agent-account",
			XQUIK_BASE_URL: "https://example.test/api/v1",
		});
		const originalFetch = globalThis.fetch;
		let capturedBody: unknown;
		globalThis.fetch = mock(
			async (_input: string | URL | Request, init?: RequestInit) => {
				capturedBody = JSON.parse(init?.body as string);
				return new Response(
					JSON.stringify({ success: true, tweetId: "reply-xq-1" }),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				);
			},
		) as unknown as typeof fetch;

		try {
			const { replyToTweet } = await import("./x/api.js");
			await expect(replyToTweet("tw-999", "Good call.")).resolves.toEqual(
				{
					id: "reply-xq-1",
				},
			);
			expect(capturedBody).toEqual({
				account: "agent-account",
				text: "Good call.",
				reply_to_tweet_id: "tw-999",
			});
		} finally {
			globalThis.fetch = originalFetch;
			restoreXquik();
		}
	});
});

describe("fetchThreadContext", () => {
	test("returns empty array when parentId is null", async () => {
		const { fetchThreadContext } = await import("./x/api.js");
		expect(await fetchThreadContext(null)).toEqual([]);
	});

	test("returns empty array when X_BEARER_TOKEN is not set", async () => {
		const restore = stubEnv({ X_BEARER_TOKEN: undefined });
		const { fetchThreadContext } = await import("./x/api.js");
		expect(await fetchThreadContext("tw-1")).toEqual([]);
		restore();
	});

	test("returns tweet nodes in chronological order", async () => {
		const restoreEnv = stubEnv({ X_BEARER_TOKEN: "test-bearer" });
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(async (url: string) => {
			if (String(url).includes("tw-grandparent")) {
				return {
					ok: true,
					json: async () => ({
						data: {
							id: "tw-grandparent",
							text: "Grandparent tweet",
							referenced_tweets: [],
						},
						includes: { users: [{ username: "bob" }] },
					}),
				} as any;
			}
			if (String(url).includes("tw-parent")) {
				return {
					ok: true,
					json: async () => ({
						data: {
							id: "tw-parent",
							text: "Parent tweet",
							referenced_tweets: [
								{ type: "replied_to", id: "tw-grandparent" },
							],
						},
						includes: { users: [{ username: "alice" }] },
					}),
				} as any;
			}
			return { ok: false, json: async () => ({}) } as any;
		}) as unknown as typeof fetch;

		const { fetchThreadContext } = await import("./x/api.js");
		const result = await fetchThreadContext("tw-parent");
		expect(result).toEqual([
			{ handle: "bob", text: "Grandparent tweet" },
			{ handle: "alice", text: "Parent tweet" },
		]);

		globalThis.fetch = originalFetch;
		restoreEnv();
	});

	test("returns empty array on fetch error", async () => {
		const restoreEnv = stubEnv({ X_BEARER_TOKEN: "test-bearer" });
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(async () => {
			throw new Error("network error");
		}) as any;
		const { fetchThreadContext } = await import("./x/api.js");
		expect(await fetchThreadContext("tw-1")).toEqual([]);
		globalThis.fetch = originalFetch;
		restoreEnv();
	});
});

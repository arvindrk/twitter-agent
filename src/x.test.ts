import { describe, it, expect, test, beforeAll, mock } from "bun:test";
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

describe("publishTweet — empty/whitespace validation", () => {
  it("throws on empty string", async () => {
    await expect(publishTweet("")).rejects.toThrow("Tweet text cannot be empty");
  });

  it("throws on whitespace-only string", async () => {
    await expect(publishTweet("   ")).rejects.toThrow("Tweet text cannot be empty");
  });
});

describe("publishTweet — length limit", () => {
  it("throws when text exceeds 280 chars", async () => {
    const text = "a".repeat(281);
    await expect(publishTweet(text)).rejects.toThrow("Tweet text exceeds 280 chars (281)");
  });

  it("accepts text at exactly 280 chars", async () => {
    const text = "a".repeat(280);
    await expect(publishTweet(text)).resolves.toMatchObject({ id: "tweet-123" });
  });
});

describe("publishTweet — X API response handling", () => {
  it("returns id on success", async () => {
    const result = await publishTweet("Hello world");
    expect(result).toEqual({ id: "tweet-123" });
  });

  it("throws when API returns no id", async () => {
    mockCreate.mockImplementationOnce(async () => ({ data: {} as { id: string } }));
    await expect(publishTweet("Hello world")).rejects.toThrow("X API returned no tweet id");
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
    expect(await replyToTweet("tw-999", "Good call.")).toEqual({ id: "reply-1" });
    expect(capturedBody).toMatchObject({
      text: "Good call.",
      reply: { in_reply_to_tweet_id: "tw-999" },
    });
  });

  test("throws on empty text", async () => {
    const { replyToTweet } = await import("./x/api.js");
    await expect(replyToTweet("tw-999", "")).rejects.toThrow("cannot be empty");
  });

  test("throws if text exceeds 280 chars", async () => {
    const { replyToTweet } = await import("./x/api.js");
    await expect(replyToTweet("tw-999", "x".repeat(281))).rejects.toThrow("exceeds 280 chars");
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
            data: { id: "tw-grandparent", text: "Grandparent tweet", referenced_tweets: [] },
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
              referenced_tweets: [{ type: "replied_to", id: "tw-grandparent" }],
            },
            includes: { users: [{ username: "alice" }] },
          }),
        } as any;
      }
      return { ok: false, json: async () => ({}) } as any;
    }) as any;

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
    globalThis.fetch = mock(async () => { throw new Error("network error"); }) as any;
    const { fetchThreadContext } = await import("./x/api.js");
    expect(await fetchThreadContext("tw-1")).toEqual([]);
    globalThis.fetch = originalFetch;
    restoreEnv();
  });
});

import { describe, it, expect, beforeAll, mock } from "bun:test";
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
  ({ publishTweet } = await import("./x.js"));
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

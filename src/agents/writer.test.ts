import { describe, it, expect, mock, beforeAll } from "bun:test";
import { sanitizeContent } from "./writer.js";

const mockGenerateObject = mock(async () => ({
  object: {
    posts: [
      { id: 1, content: "First post", type: "single" },
      { id: 2, content: "Second post — with em dash", type: "single" },
    ],
  },
  usage: { inputTokens: 10, outputTokens: 20 },
}));

mock.module("ai", () => ({ generateObject: mockGenerateObject }));
mock.module("@ai-sdk/xai", () => ({ xai: () => ({}) }));

let runWriter: (msg: string) => Promise<unknown[]>;

beforeAll(async () => {
  ({ runWriter } = await import("./writer.js"));
});

describe("sanitizeContent", () => {
  it("replaces em-dash with comma and space", () => {
    expect(sanitizeContent("foo — bar")).toBe("foo, bar");
  });

  it("handles multiple em-dashes", () => {
    expect(sanitizeContent("a — b — c")).toBe("a, b, c");
  });

  it("leaves strings without em-dashes unchanged", () => {
    expect(sanitizeContent("no change here")).toBe("no change here");
  });
});

describe("runWriter", () => {
  it("returns typed Post[] from model output", async () => {
    const posts = await runWriter("some research brief") as Array<{ id: number; content: string; type: string }>;
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({ id: 1, content: "First post", type: "single" });
  });

  it("applies sanitizeContent to post content", async () => {
    const posts = await runWriter("brief") as Array<{ content: string }>;
    expect(posts[1].content).toBe("Second post, with em dash");
  });
});

import type { Post } from "../agents/writer.js";
import type { ScheduleItem } from "../agents/scheduler.js";

export function makePost(overrides: Partial<Post> = {}): Post {
  return { id: 1, content: "Test post content", type: "single", ...overrides };
}

export function makeScheduleItem(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    postId: 1,
    scheduledAt: "2026-04-29T13:00:00.000Z",
    slot: "morning",
    rationale: "Peak engagement window",
    ...overrides,
  };
}

export const stubDbModule = {
  insertScheduledPosts: async () => [{ id: 1 }],
  claimPost: async () => null,
  markPublished: async () => {},
  markFailed: async () => {},
  getPostsDue: async () => [],
  resetStalePosts: async () => {},
};

export const stubXModule = {
  publishTweet: async () => ({ id: "tweet-123" }),
};

export function stubEnv(vars: Record<string, string>) {
  const original: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    original[k] = process.env[k];
    process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

import type { Post } from "../agents/writer.js";
import type { ScheduleItem } from "../agents/scheduler.js";

type DbPost = {
  id: number;
  content: string;
  type: "single" | "thread";
  status: "pending" | "processing" | "published" | "failed";
  scheduledAt: Date;
  slot: "morning" | "lunch" | "afternoon" | "evening" | "night";
  rationale: string;
  tweetId: string | null;
  tweetUrl: string | null;
  error: string | null;
  createdAt: Date;
  publishedAt: Date | null;
};

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

export function makeDbPost(overrides: Partial<DbPost> = {}): DbPost {
  return {
    id: 1,
    content: "Hello world",
    type: "single",
    status: "processing",
    scheduledAt: new Date("2026-04-29T13:00:00.000Z"),
    slot: "morning",
    rationale: "",
    tweetId: null,
    tweetUrl: null,
    error: null,
    createdAt: new Date("2026-04-29T00:00:00.000Z"),
    publishedAt: null,
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
  claimEngagement: async () => true,
  markEngagementReplied: async () => {},
  markEngagementSkipped: async () => {},
  markEngagementFailed: async () => {},
};

export const stubXModule = {
  publishTweet: async () => ({ id: "tweet-123" }),
  replyToTweet: async () => ({ id: "reply-456" }),
  likeTweet: async () => {},
  fetchThreadContext: async () => [],
};

export const stubInboundEngagementModule = {
  runInboundEngagementAgent: async () => ({
    like: false,
    reply: { content: "Solid.", stance: "close" as const },
    reason: "Worthwhile question.",
  }),
};

export function stubEnv(vars: Record<string, string | undefined>) {
  const original: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    original[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

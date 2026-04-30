import { describe, it, expect, mock, beforeAll, afterAll, spyOn } from "bun:test";
import { stubEnv, stubDbModule, stubXModule, makePost } from "./test/helpers.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db: Record<string, any> = { ...stubDbModule };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const x: Record<string, any> = { ...stubXModule };

// Wrapper functions so named imports in app.ts always delegate to current db/x values.
mock.module("./db.js", () => ({
  insertScheduledPosts: (...a: unknown[]) => db.insertScheduledPosts(...a),
  claimPost: (...a: unknown[]) => db.claimPost(...a),
  markPublished: (...a: unknown[]) => db.markPublished(...a),
  markFailed: (...a: unknown[]) => db.markFailed(...a),
  getPostsDue: (...a: unknown[]) => db.getPostsDue(...a),
  resetStalePosts: (...a: unknown[]) => db.resetStalePosts(...a),
}));
mock.module("./x.js", () => ({
  publishTweet: (...a: unknown[]) => x.publishTweet(...a),
}));
mock.module("./pipeline.js", () => ({
  runDailyWorkflow: mock(async () => []),
}));

let app: import("hono").Hono;
let restore: () => void;

beforeAll(async () => {
  restore = stubEnv({ CRON_SECRET: "test-secret" });
  ({ default: app } = await import("./app.js"));
});

afterAll(() => restore());

const authed = { headers: { "x-cron-secret": "test-secret" } };
const cronUrl = (path: string) => `http://localhost${path}`;

describe("isAuthorized — middleware", () => {
  it("allows requests when CRON_SECRET env is not set", async () => {
    delete process.env.CRON_SECRET;
    const res = await app.request(cronUrl("/"), { method: "GET" });
    expect(res.status).toBe(200);
    process.env.CRON_SECRET = "test-secret";
  });

  it("allows requests with correct secret in x-cron-secret header", async () => {
    const res = await app.request(cronUrl("/cron/daily"), { method: "GET", ...authed });
    expect(res.status).toBe(202);
  });

  it("allows requests with correct secret as query param", async () => {
    const res = await app.request(cronUrl("/cron/daily?secret=test-secret"), { method: "GET" });
    expect(res.status).toBe(202);
  });

  it("rejects requests with wrong secret", async () => {
    const res = await app.request(cronUrl("/cron/daily"), {
      method: "GET",
      headers: { "x-cron-secret": "wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests with missing secret when CRON_SECRET is set", async () => {
    const res = await app.request(cronUrl("/cron/daily"), { method: "GET" });
    expect(res.status).toBe(401);
  });
});

describe("GET /", () => {
  it("returns 200 with ok: true", async () => {
    const res = await app.request(cronUrl("/"), { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GET /cron/daily", () => {
  it("returns 202 with runId and fires pipeline async", async () => {
    const res = await app.request(cronUrl("/cron/daily"), { method: "GET", ...authed });
    expect(res.status).toBe(202);
    const body = await res.json() as { ok: boolean; runId: string };
    expect(body.ok).toBe(true);
    expect(typeof body.runId).toBe("string");
    expect(body.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe("POST /cron/execute-post — scan mode", () => {
  const post = (body?: object) =>
    app.request(cronUrl("/cron/execute-post"), {
      method: "POST",
      ...authed,
      headers: { ...authed.headers, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

  it("returns 401 when unauthorized", async () => {
    const res = await app.request(cronUrl("/cron/execute-post"), { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("scan mode: processes due posts and returns summary", async () => {
    db.getPostsDue = mock(async () => [{ id: 1 }]);
    db.claimPost = mock(async () => ({
      id: 1,
      content: "Hello world",
      type: "single" as const,
      status: "processing" as const,
      scheduledAt: new Date(),
      slot: "morning" as const,
      rationale: "",
      tweetId: null,
      tweetUrl: null,
      error: null,
      createdAt: new Date(),
      publishedAt: null,
    }));
    db.markPublished = mock(async () => {});
    db.resetStalePosts = mock(async () => {});

    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; processed: number; skipped: number; failed: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(1);
    expect(body.skipped).toBe(0);
    expect(body.failed).toHaveLength(0);
  });

  it("scan mode: increments skipped when claimPost returns null", async () => {
    db.getPostsDue = mock(async () => [{ id: 1 }]);
    db.claimPost = mock(async () => null);
    db.resetStalePosts = mock(async () => {});

    const res = await post();
    const body = await res.json() as { skipped: number };
    expect(body.skipped).toBe(1);
  });

  it("scan mode: rejects thread posts into failed[]", async () => {
    db.getPostsDue = mock(async () => [{ id: 2 }]);
    db.claimPost = mock(async () => ({
      id: 2,
      content: "Thread content",
      type: "thread" as const,
      status: "processing" as const,
      scheduledAt: new Date(),
      slot: "morning" as const,
      rationale: "",
      tweetId: null,
      tweetUrl: null,
      error: null,
      createdAt: new Date(),
      publishedAt: null,
    }));
    db.markFailed = mock(async () => {});
    db.resetStalePosts = mock(async () => {});

    const res = await post();
    const body = await res.json() as { failed: { id: number; error: string }[] };
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].id).toBe(2);
  });

  it("scan mode: records publishTweet failure in failed[]", async () => {
    db.getPostsDue = mock(async () => [{ id: 3 }]);
    db.claimPost = mock(async () => ({
      id: 3,
      content: "Hello world",
      type: "single" as const,
      status: "processing" as const,
      scheduledAt: new Date(),
      slot: "morning" as const,
      rationale: "",
      tweetId: null,
      tweetUrl: null,
      error: null,
      createdAt: new Date(),
      publishedAt: null,
    }));
    db.markFailed = mock(async () => {});
    db.resetStalePosts = mock(async () => {});
    x.publishTweet = mock(async () => { throw new Error("X API down"); });

    const res = await post();
    const body = await res.json() as { failed: { id: number; error: string }[] };
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].error).toBe("X API down");

    x.publishTweet = mock(async () => ({ id: "tweet-123" }));
  });
});

describe("POST /cron/execute-post — single-post mode", () => {
  const singlePost = (postId: number) =>
    app.request(cronUrl("/cron/execute-post"), {
      method: "POST",
      ...authed,
      headers: { ...authed.headers, "content-type": "application/json" },
      body: JSON.stringify({ postId }),
    });

  const claimedPost = (overrides: object = {}) => ({
    id: 10,
    content: "Hello world",
    type: "single" as const,
    status: "processing" as const,
    scheduledAt: new Date(),
    slot: "morning" as const,
    rationale: "",
    tweetId: null,
    tweetUrl: null,
    error: null,
    createdAt: new Date(),
    publishedAt: null,
    ...overrides,
  });

  it("happy path: publishes tweet and returns tweetId", async () => {
    db.claimPost = mock(async () => claimedPost());
    db.markPublished = mock(async () => {});
    x.publishTweet = mock(async () => ({ id: "tweet-456" }));

    const res = await singlePost(10);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; tweetId: string; tweetUrl: string };
    expect(body.ok).toBe(true);
    expect(body.tweetId).toBe("tweet-456");
    expect(body.tweetUrl).toBe("https://x.com/i/web/status/tweet-456");
  });

  it("returns skipped when claimPost returns null", async () => {
    db.claimPost = mock(async () => null);

    const res = await singlePost(10);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("skipped");
  });

  it("returns 501 for thread type", async () => {
    db.claimPost = mock(async () => claimedPost({ type: "thread" }));
    db.markFailed = mock(async () => {});

    const res = await singlePost(10);
    expect(res.status).toBe(501);
  });

  it("returns 500 when publishTweet throws", async () => {
    db.claimPost = mock(async () => claimedPost());
    db.markFailed = mock(async () => {});
    x.publishTweet = mock(async () => { throw new Error("rate limited"); });

    const res = await singlePost(10);
    expect(res.status).toBe(500);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("rate limited");

    x.publishTweet = mock(async () => ({ id: "tweet-123" }));
  });
});

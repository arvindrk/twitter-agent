import { describe, it, expect, mock, beforeAll, afterAll, beforeEach } from "bun:test";
import { stubEnv, stubDbModule, stubXModule, stubEngagementModule, makePost, makeDbPost } from "./test/helpers.js";
import { createHmac } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db: Record<string, any> = { ...stubDbModule };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const x: Record<string, any> = { ...stubXModule };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const engagement: Record<string, any> = { ...stubEngagementModule };

// Wrapper functions so named imports in app.ts always delegate to current db/x values.
mock.module("./db.js", () => ({
  insertScheduledPosts: (...a: unknown[]) => db.insertScheduledPosts(...a),
  claimPost: (...a: unknown[]) => db.claimPost(...a),
  markPublished: (...a: unknown[]) => db.markPublished(...a),
  markFailed: (...a: unknown[]) => db.markFailed(...a),
  getPostsDue: (...a: unknown[]) => db.getPostsDue(...a),
  resetStalePosts: (...a: unknown[]) => db.resetStalePosts(...a),
  claimEngagement: (...a: unknown[]) => db.claimEngagement(...a),
  markEngagementReplied: (...a: unknown[]) => db.markEngagementReplied(...a),
  markEngagementSkipped: (...a: unknown[]) => db.markEngagementSkipped(...a),
  markEngagementFailed: (...a: unknown[]) => db.markEngagementFailed(...a),
}));
mock.module("./x.js", () => ({
  publishTweet: (...a: unknown[]) => x.publishTweet(...a),
  replyToTweet: (...a: unknown[]) => x.replyToTweet(...a),
  likeTweet: (...a: unknown[]) => x.likeTweet(...a),
  fetchThreadContext: (...a: unknown[]) => x.fetchThreadContext(...a),
}));
mock.module("./agents/engagement.js", () => ({
  runEngagementAgent: (...a: unknown[]) => engagement.runEngagementAgent(...a),
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

beforeEach(() => {
  Object.assign(db, { ...stubDbModule });
  Object.assign(x, { ...stubXModule });
  Object.assign(engagement, { ...stubEngagementModule });
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
    db.claimPost = mock(async () => makeDbPost({ id: 1, content: "Hello world" }));
    db.markPublished = mock(async () => {});
    db.resetStalePosts = mock(async () => {});

    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; processed: number; skipped: number; failed: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(1);
    expect(body.skipped).toBe(0);
    expect(body.failed).toHaveLength(0);
    expect(db.claimPost).toHaveBeenCalledWith(1);
    expect(db.markPublished).toHaveBeenCalledWith(1, "tweet-123", "https://x.com/i/web/status/tweet-123");
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
    db.claimPost = mock(async () => makeDbPost({ id: 2, content: "Thread content", type: "thread" }));
    db.markFailed = mock(async () => {});
    db.resetStalePosts = mock(async () => {});

    const res = await post();
    const body = await res.json() as { failed: { id: number; error: string }[] };
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].id).toBe(2);
    expect(db.markFailed).toHaveBeenCalledWith(2, "Thread publishing not yet implemented");
  });

  it("scan mode: records publishTweet failure in failed[]", async () => {
    db.getPostsDue = mock(async () => [{ id: 3 }]);
    db.claimPost = mock(async () => makeDbPost({ id: 3, content: "Hello world" }));
    db.markFailed = mock(async () => {});
    db.resetStalePosts = mock(async () => {});
    x.publishTweet = mock(async () => { throw new Error("X API down"); });

    const res = await post();
    const body = await res.json() as { failed: { id: number; error: string }[] };
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].error).toBe("X API down");
    expect(db.markFailed).toHaveBeenCalledWith(3, "X API down");
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

  const claimedPost = (overrides = {}) => makeDbPost({ id: 10, ...overrides });

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
    expect(db.claimPost).toHaveBeenCalledWith(10);
    expect(x.publishTweet).toHaveBeenCalledWith("Hello world");
    expect(db.markPublished).toHaveBeenCalledWith(10, "tweet-456", "https://x.com/i/web/status/tweet-456");
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
    expect(db.markFailed).toHaveBeenCalledWith(10, "rate limited");
  });
});

const WEBHOOK_SECRET = "test-api-secret";
const MY_USER_ID = "me-42";

function webhookSig(body: string) {
  return "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(body).digest("base64");
}

function mentionPayload(tweetId = "tw-1", authorId = "user-99") {
  return JSON.stringify({
    for_user_id: MY_USER_ID,
    tweet_create_events: [{
      id_str: tweetId,
      text: "@me how does your agent handle rate limits?",
      user: { id_str: authorId, screen_name: "devuser" },
      in_reply_to_status_id_str: null,
      in_reply_to_user_id_str: MY_USER_ID,
      is_quote_status: false,
      entities: { user_mentions: [{ id_str: MY_USER_ID, screen_name: "me" }] },
    }],
  });
}

describe("GET /webhooks/x", () => {
  it("returns sha256 CRC response for valid crc_token", async () => {
    const restore = stubEnv({ X_API_SECRET: WEBHOOK_SECRET });
    const res = await app.request("http://localhost/webhooks/x?crc_token=abc123");
    restore();
    expect(res.status).toBe(200);
    const body = await res.json() as { response_token: string };
    expect(body.response_token).toMatch(/^sha256=/);
    const expectedToken = "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update("abc123").digest("base64");
    expect(body.response_token).toBe(expectedToken);
  });

  it("returns 400 when crc_token is missing", async () => {
    const res = await app.request("http://localhost/webhooks/x");
    expect(res.status).toBe(400);
  });
});

describe("POST /webhooks/x", () => {
  it("returns 401 with invalid signature", async () => {
    const restore = stubEnv({ X_API_SECRET: WEBHOOK_SECRET });
    const body = mentionPayload();
    const res = await app.request("http://localhost/webhooks/x", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-twitter-webhooks-signature": "sha256=bad" },
      body,
    });
    restore();
    expect(res.status).toBe(401);
  });

  it("returns 200 with valid signature", async () => {
    const restore = stubEnv({ X_API_SECRET: WEBHOOK_SECRET, X_USER_ID: MY_USER_ID });
    const body = mentionPayload();
    const res = await app.request("http://localhost/webhooks/x", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-twitter-webhooks-signature": webhookSig(body) },
      body,
    });
    restore();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 200 and is a no-op for payloads with no tweet_create_events", async () => {
    const restore = stubEnv({ X_API_SECRET: WEBHOOK_SECRET, X_USER_ID: MY_USER_ID });
    const body = JSON.stringify({ for_user_id: MY_USER_ID });
    const res = await app.request("http://localhost/webhooks/x", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-twitter-webhooks-signature": webhookSig(body) },
      body,
    });
    restore();
    expect(res.status).toBe(200);
  });
});

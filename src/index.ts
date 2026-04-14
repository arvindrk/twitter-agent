import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { runDailyWorkflow } from "./pipeline.js";
import {
  insertScheduledPosts,
  claimPost,
  markPublished,
  markFailed,
} from "./db.js";
import { publishTweet } from "./x.js";

const app = new Hono();
const CRON_SECRET = process.env.CRON_SECRET;

function isAuthorized(req: Request): boolean {
  if (!CRON_SECRET) return true;
  const token =
    req.headers.get("x-cron-secret") ??
    new URL(req.url).searchParams.get("secret");
  return token === CRON_SECRET;
}

app.get("/", (c) => c.json({ ok: true }));

// Triggered by cron-job.org each morning. Fires the full pipeline async and
// returns 202 immediately to avoid HTTP timeouts (pipeline takes 30-90s).
app.get("/cron/daily", async (c) => {
  if (!isAuthorized(c.req.raw))
    return c.json({ ok: false, error: "Unauthorized" }, 401);

  const runId = crypto.randomUUID();
  console.log(`[cron/daily] Starting run ${runId}`);

  runDailyWorkflow()
    .then(async (posts) => {
      console.log(
        `[cron/daily] Run ${runId} complete — ${posts.length} posts scheduled`,
      );
      const rows = await insertScheduledPosts(
        posts.map((p) => ({
          content: p.content,
          type: p.type,
          scheduledAt: new Date(p.scheduledAt),
          slot: p.slot,
          rationale: p.rationale,
        })),
      );
      console.log(
        `[cron/daily] Persisted to Neon — ids: ${rows.map((r) => r.id).join(", ")}`,
      );
    })
    .catch((err: Error) =>
      console.error(`[cron/daily] Run ${runId} threw:`, err.message),
    );

  return c.json({ ok: true, runId }, 202);
});

// Called by pg_cron for each due post. Atomically claims the row (pending →
// processing) then publishes and updates status.
app.post("/cron/execute-post", async (c) => {
  if (!isAuthorized(c.req.raw))
    return c.json({ ok: false, error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.postId !== "number")
    return c.json(
      { ok: false, error: "Body must include { postId: number }" },
      400,
    );

  const { postId } = body as { postId: number };
  console.log(`[cron/execute-post] Claiming post ${postId}`);

  const post = await claimPost(postId);
  if (!post) {
    console.log(
      `[cron/execute-post] Post ${postId} already claimed or not found — skipping`,
    );
    return c.json({ ok: true, status: "skipped" });
  }

  if (post.type === "thread") {
    await markFailed(post.id, "Thread publishing not yet implemented");
    return c.json(
      { ok: false, error: "Thread publishing not yet implemented" },
      501,
    );
  }

  try {
    const result = await publishTweet(post.content);
    const tweetUrl = `https://x.com/i/web/status/${result.id}`;
    await markPublished(post.id, result.id, tweetUrl);
    console.log(
      `[cron/execute-post] Published post ${postId} → tweet ${result.id}`,
    );
    return c.json({ ok: true, tweetId: result.id, tweetUrl });
  } catch (err: any) {
    console.error(
      `[cron/execute-post] Failed to publish post ${postId}:`,
      err.message,
    );
    await markFailed(post.id, err.message);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/test/post", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const text: string =
    body.text ?? `test post from x-agent — ${new Date().toISOString()}`;
  try {
    const result = await publishTweet(text);
    return c.json({ ok: true, tweet: result });
  } catch (err: any) {
    console.error("[/test/post]", err);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

serve({ fetch: app.fetch, port: 3010 }, (info) =>
  console.log(`Server is running on http://localhost:${info.port}`),
);

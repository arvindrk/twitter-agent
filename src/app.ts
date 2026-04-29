import { Hono } from "hono";
import { runDailyWorkflow } from "./pipeline.js";
import {
  insertScheduledPosts,
  claimPost,
  markPublished,
  markFailed,
  getPostsDue,
  resetStalePosts,
} from "./db.js";
import { publishTweet } from "./x.js";

const app = new Hono();
const CRON_SECRET = process.env.CRON_SECRET;

async function rejectThreadPost(id: number): Promise<string> {
  const msg = "Thread publishing not yet implemented";
  await markFailed(id, msg);
  return msg;
}

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

// Called by cron-job.org every 30 min (no body → scan mode) or manually with
// { postId } for single-post execution.
app.post("/cron/execute-post", async (c) => {
  if (!isAuthorized(c.req.raw))
    return c.json({ ok: false, error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => null);

  // ── Scan mode: no postId → execute all due posts ──────────────────────────
  if (!body || typeof body.postId !== "number") {
    const due = await getPostsDue();
    console.log(`[cron/execute-post] Scan mode — ${due.length} due post(s)`);

    let processed = 0;
    let skipped = 0;
    const failed: { id: number; error: string }[] = [];

    for (const { id } of due) {
      const post = await claimPost(id);
      if (!post) {
        skipped++;
        continue;
      }

      if (post.type === "thread") {
        const error = await rejectThreadPost(post.id);
        failed.push({ id: post.id, error });
        continue;
      }

      try {
        const result = await publishTweet(post.content);
        const tweetUrl = `https://x.com/i/web/status/${result.id}`;
        await markPublished(post.id, result.id, tweetUrl);
        console.log(`[cron/execute-post] Published post ${id} → tweet ${result.id}`);
        processed++;
      } catch (err: any) {
        console.error(`[cron/execute-post] Failed post ${id}:`, err.message);
        await markFailed(post.id, err.message);
        failed.push({ id: post.id, error: err.message });
      }
    }

    return c.json({ ok: true, processed, skipped, failed });
  }

  // ── Single-post mode: explicit postId ────────────────────────────────────
  const { postId } = body as { postId: number };
  console.log(`[cron/execute-post] Claiming post ${postId}`);

  const post = await claimPost(postId);
  if (!post) {
    console.log(`[cron/execute-post] Post ${postId} already claimed or not found — skipping`);
    return c.json({ ok: true, status: "skipped" });
  }

  if (post.type === "thread") {
    const error = await rejectThreadPost(post.id);
    return c.json({ ok: false, error }, 501);
  }

  try {
    const result = await publishTweet(post.content);
    const tweetUrl = `https://x.com/i/web/status/${result.id}`;
    await markPublished(post.id, result.id, tweetUrl);
    console.log(`[cron/execute-post] Published post ${postId} → tweet ${result.id}`);
    return c.json({ ok: true, tweetId: result.id, tweetUrl });
  } catch (err: any) {
    console.error(`[cron/execute-post] Failed to publish post ${postId}:`, err.message);
    await markFailed(post.id, err.message);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

export default app;

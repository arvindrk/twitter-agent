import { Hono } from "hono";
import type { HonoBindings, HonoVariables } from "@mastra/hono";
import { mastra } from "../mastra/index.js";
import { insertScheduledPosts, claimPost, markPublished, markFailed } from "../db/queries.js";
import { publishTweet } from "../x/poster.js";

const automation = new Hono<{
  Bindings: HonoBindings;
  Variables: HonoVariables;
}>();

// ── Secret token guard ────────────────────────────────────────────────────────

const CRON_SECRET = process.env.CRON_SECRET;

function isAuthorized(req: Request): boolean {
  if (!CRON_SECRET) return true; // no secret configured, allow all (dev only)
  const token =
    req.headers.get("x-cron-secret") ??
    new URL(req.url).searchParams.get("secret");
  return token === CRON_SECRET;
}

// ── GET /cron/daily ───────────────────────────────────────────────────────────
// Triggered by cron-job.org each morning. Fires the full pipeline async and
// returns 202 immediately to avoid HTTP timeouts (pipeline takes 30-90s).

automation.get("/daily", async (c) => {
  if (!isAuthorized(c.req.raw)) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }

  const runId = crypto.randomUUID();
  console.log(`[cron/daily] Starting run ${runId}`);

  // Fire and forget — do not await
  (async () => {
    try {
      const workflow = mastra.getWorkflow("dailyWorkflow");
      const run = await workflow.createRun();
      const result = await run.start({ inputData: {} });

      if (result.status === "success") {
        const { scheduledPosts } = result.result;
        console.log(`[cron/daily] Run ${runId} complete — ${scheduledPosts.length} posts scheduled`);

        const rows = await insertScheduledPosts(
          scheduledPosts.map((p: any) => ({
            content: p.content,
            type: p.type,
            scheduledAt: new Date(p.scheduledAt),
            slot: p.slot,
            rationale: p.rationale,
          })),
        );
        console.log(`[cron/daily] Persisted to Neon — ids: ${rows.map((r) => r.id).join(", ")}`);
      } else {
        const err = result.status === "failed" ? result.error : undefined;
        console.error(
          `[cron/daily] Run ${runId} failed:`,
          result.status,
          err?.message,
        );
      }
    } catch (err: any) {
      console.error(`[cron/daily] Run ${runId} threw:`, err.message);
    }
  })();

  return c.json({ ok: true, runId }, 202);
});

// ── POST /cron/execute-post ───────────────────────────────────────────────────
// Called by pg_cron for each due post. Body: { postId: number }
// Atomically claims the row (pending → processing) then publishes and updates status.

automation.post("/execute-post", async (c) => {
  if (!isAuthorized(c.req.raw)) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.postId !== "number") {
    return c.json(
      { ok: false, error: "Body must include { postId: number }" },
      400,
    );
  }

  const { postId } = body as { postId: number };
  console.log(`[cron/execute-post] Claiming post ${postId}`);

  // Atomic CAS: pending → processing. Null means already claimed or not found.
  const post = await claimPost(postId);
  if (!post) {
    console.log(
      `[cron/execute-post] Post ${postId} already claimed or not found — skipping`,
    );
    return c.json({ ok: true, status: "skipped" });
  }

  if (post.type === "thread") {
    // Thread publishing (split on \n---\n, reply chain) is not yet implemented.
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

export { automation };

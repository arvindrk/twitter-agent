import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { runDailyWorkflow } from "./pipeline.js";
import {
  insertScheduledPosts,
  claimPost,
  markPublished,
  markFailed,
  getPostsDue,
  resetStalePosts,
  claimEngagement,
  markEngagementReplied,
  markEngagementSkipped,
  markEngagementFailed,
} from "./db.js";
import { publishTweet, replyToTweet, likeTweet, fetchThreadContext } from "./x.js";
import { runEngagementAgent } from "./agents/engagement.js";

interface XTweetEvent {
  id_str: string;
  text: string;
  user: { id_str: string; screen_name: string };
  in_reply_to_status_id_str: string | null;
  in_reply_to_user_id_str: string | null;
  is_quote_status: boolean;
  entities?: { user_mentions?: { id_str: string; screen_name: string }[] };
}

interface XWebhookPayload {
  for_user_id: string;
  tweet_create_events?: XTweetEvent[];
}

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

function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const secret = process.env.X_API_SECRET;
  if (!secret) return false;
  const expected =
    "sha256=" + createHmac("sha256", secret).update(rawBody).digest("base64");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function processEngagementEvent(payload: XWebhookPayload): Promise<void> {
  const events = payload.tweet_create_events;
  if (!events?.length) return;

  const myUserId = process.env.X_USER_ID;
  if (!myUserId) {
    console.error("[webhooks/x] X_USER_ID not set");
    return;
  }

  const SEP = "─".repeat(50);

  for (const tweet of events) {
    if (tweet.user.id_str === myUserId) continue;

    const isMention = tweet.entities?.user_mentions?.some((m) => m.id_str === myUserId);
    const isReplyToMe = tweet.in_reply_to_user_id_str === myUserId;
    if (!isMention && !isReplyToMe) continue;

    const eventType = isMention ? "mention" : "reply";

    console.log(`\n[engagement] ${SEP}`);
    console.log(`[engagement] tweet=${tweet.id_str} type=${eventType} from=@${tweet.user.screen_name}`);
    const displayText = tweet.text.length > 100 ? tweet.text.slice(0, 97) + "..." : tweet.text;
    console.log(`[engagement] text: "${displayText}"`);

    const claimed = await claimEngagement(tweet.id_str, eventType);
    if (!claimed) {
      console.log(`[engagement] already claimed, skipping`);
      console.log(`[engagement] ${SEP}\n`);
      continue;
    }

    try {
      const thread = await fetchThreadContext(tweet.in_reply_to_status_id_str);
      if (thread.length > 0) console.log(`[engagement] thread: ${thread.length} node(s)`);

      const decision = await runEngagementAgent({
        tweetId: tweet.id_str,
        authorHandle: tweet.user.screen_name,
        text: tweet.text,
        thread,
      });

      if (decision.like) {
        await likeTweet(tweet.id_str).catch((err: unknown) => {
          console.error(`[engagement] → like failed: ${err instanceof Error ? err.message : err}`);
        });
      }

      if (decision.reply === null) {
        await markEngagementSkipped(tweet.id_str, decision.reason, decision.like);
        console.log(`[engagement] → no reply (like=${decision.like}): ${decision.reason}`);
        console.log(`[engagement] ${SEP}\n`);
        continue;
      }

      console.log(`[engagement] → reply stance=${decision.reply.stance} like=${decision.like}`);
      console.log(`[engagement] → content: "${decision.reply.content}"`);
      const result = await replyToTweet(tweet.id_str, decision.reply.content);
      await markEngagementReplied(tweet.id_str, result.id, decision.like);
      console.log(`[engagement] → posted reply ${result.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[engagement] → error: ${msg}`);
      await markEngagementFailed(tweet.id_str, msg).catch((dbErr: unknown) => {
        console.error(`[engagement] → failed to mark failure: ${dbErr instanceof Error ? dbErr.message : dbErr}`);
      });
    }

    console.log(`[engagement] ${SEP}\n`);
  }
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
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron/daily] Run ${runId} threw:`, msg);
    });

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
    await resetStalePosts();
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
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[cron/execute-post] Failed post ${id}:`, msg);
        await markFailed(post.id, msg);
        failed.push({ id: post.id, error: msg });
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cron/execute-post] Failed to publish post ${postId}:`, msg);
    await markFailed(post.id, msg);
    return c.json({ ok: false, error: msg }, 500);
  }
});

app.get("/webhooks/x", (c) => {
  const crcToken = c.req.query("crc_token");
  if (!crcToken) return c.json({ error: "missing crc_token" }, 400);
  const secret = process.env.X_API_SECRET;
  if (!secret) return c.json({ error: "server misconfigured" }, 500);
  const hash = createHmac("sha256", secret).update(crcToken).digest("base64");
  return c.json({ response_token: `sha256=${hash}` });
});

app.post("/webhooks/x", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-twitter-webhooks-signature");

  if (!verifyWebhookSignature(rawBody, signature))
    return c.json({ error: "Invalid signature" }, 401);

  processEngagementEvent(JSON.parse(rawBody) as XWebhookPayload).catch((err: unknown) => {
    console.error("[webhooks/x] unhandled error:", err instanceof Error ? err.message : err);
  });

  return c.json({ ok: true });
});

export default app;

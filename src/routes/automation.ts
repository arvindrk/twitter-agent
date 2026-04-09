import { Hono } from "hono";
import type { HonoBindings, HonoVariables } from "@mastra/hono";
import { mastra } from "../mastra/index.js";

const automation = new Hono<{ Bindings: HonoBindings; Variables: HonoVariables }>();

// ── Secret token guard ────────────────────────────────────────────────────────

const CRON_SECRET = process.env.CRON_SECRET;

function isAuthorized(req: Request): boolean {
  if (!CRON_SECRET) return true; // no secret configured, allow all (dev only)
  const token = req.headers.get("x-cron-secret") ?? new URL(req.url).searchParams.get("secret");
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
        console.log(`[cron/daily] Run ${runId} complete — ${result.result.scheduledPosts.length} posts scheduled`);
      } else {
        const err = result.status === "failed" ? result.error : undefined;
        console.error(`[cron/daily] Run ${runId} failed:`, result.status, err?.message);
      }
    } catch (err: any) {
      console.error(`[cron/daily] Run ${runId} threw:`, err.message);
    }
  })();

  return c.json({ ok: true, runId }, 202);
});

// ── POST /cron/execute-post ───────────────────────────────────────────────────
// Placeholder: will execute a scheduled post at the right time.
// Body: { postId: number, content: string, type: "single" | "thread" }

automation.post("/execute-post", async (c) => {
  if (!isAuthorized(c.req.raw)) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  console.log("[cron/execute-post] Received:", JSON.stringify(body));

  // TODO: implement posting logic
  return c.json({ ok: true, status: "not_implemented" }, 501);
});

export { automation };

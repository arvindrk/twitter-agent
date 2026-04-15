# Publish-Due Cron Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend `/cron/execute-post` to scan and execute all due posts when called with no body, enabling cron-job.org to fire it every 30 minutes.

**Architecture:** Add `getPostsDue()` to `src/db.ts` to fetch pending post IDs where `scheduled_at <= NOW()`. Modify the existing route handler in `src/index.ts` to branch on whether `postId` is present -- if not, run the scan-and-execute loop sequentially. No new files, no new routes, no schema changes.

**Tech Stack:** Bun, Hono, Drizzle ORM, Neon (serverless Postgres), `@ai-sdk/xai`

---

### Task 1: Add `getPostsDue` query to `src/db.ts`

**Files:**
- Modify: `src/db.ts`

**Step 1: Add the query function**

In `src/db.ts`, add after `markFailed`:

```ts
export function getPostsDue(): Promise<{ id: number }[]> {
  return db
    .select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.status, "pending"),
        sql`${scheduledPosts.scheduledAt} <= NOW()`,
      ),
    );
}
```

Also add `getPostsDue` to the import list in `src/index.ts` (just the import line for now -- implementation comes in Task 2).

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/db.ts
git commit -m "feat: add getPostsDue query"
```

---

### Task 2: Extend `/cron/execute-post` with scan mode

**Files:**
- Modify: `src/index.ts`

**Step 1: Update the import from `./db.js`**

Add `getPostsDue` to the existing import:

```ts
import {
  insertScheduledPosts,
  claimPost,
  markPublished,
  markFailed,
  getPostsDue,
} from "./db.js";
```

**Step 2: Replace the route handler body**

Replace the full `app.post("/cron/execute-post", ...)` handler with:

```ts
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
        await markFailed(post.id, "Thread publishing not yet implemented");
        failed.push({ id: post.id, error: "Thread publishing not yet implemented" });
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
    await markFailed(post.id, "Thread publishing not yet implemented");
    return c.json({ ok: false, error: "Thread publishing not yet implemented" }, 501);
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
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 4: Manual smoke test — scan mode with no due posts**

With server running (`npm run dev`):

```bash
curl -s -X POST http://localhost:3010/cron/execute-post \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: <your-secret>"
```

Expected response (assuming no due posts in DB):
```json
{ "ok": true, "processed": 0, "skipped": 0, "failed": [] }
```

**Step 5: Manual smoke test — single-post mode still works**

```bash
npm run test:cron:execute-post
```

Expected: same behavior as before (skipped or published depending on DB state).

**Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: extend execute-post with scan mode for cron-job.org"
```

---

### Task 3: Update package.json test script for scan mode

**Files:**
- Modify: `package.json`

**Step 1: Add a scan-mode test script**

In `package.json` `scripts`, add:

```json
"test:cron:scan": "dotenvx run -- curl -s -w '\\nHTTP %{http_code}' -X POST http://localhost:3010/cron/execute-post -H 'Content-Type: application/json' -H \"x-cron-secret:44a24d2a8adafb03cdeb668b69180b6af71883d650e0ed424ebd0191ecaa73dd\""
```

Note: no `-d` body -- this is what triggers scan mode.

**Step 2: Run it**

```bash
npm run test:cron:scan
```

Expected:
```
{"ok":true,"processed":0,"skipped":0,"failed":[]}
HTTP 200
```

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add test:cron:scan script"
```

---

### Task 4: Document cron-job.org setup in README

**Files:**
- Modify: `README.md`

**Step 1: Add cron-job.org configuration section**

Find the existing cron/deployment section in `README.md` and add:

```markdown
### Publish-Due Cron (cron-job.org)

Create a second job on [cron-job.org](https://cron-job.org):

- **URL:** `POST https://<your-vercel-url>/cron/execute-post`
- **Headers:** `x-cron-secret: <CRON_SECRET>`, `Content-Type: application/json`
- **Body:** empty
- **Schedule:** every 30 minutes

No body means scan mode: queries all `pending` posts with `scheduled_at <= NOW()` and publishes each.
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add cron-job.org publish-due setup instructions"
```

---

## Done

All changes are in 2 source files (`src/db.ts`, `src/index.ts`) + `package.json` + `README.md`. No schema migrations. No new dependencies.

After deploying to Vercel, configure cron-job.org with the live URL to activate the 30-minute publish loop.

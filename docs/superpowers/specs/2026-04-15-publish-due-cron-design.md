# Publish-Due Cron Design

**Date:** 2026-04-15  
**Status:** Approved

## Problem

Scheduled posts are written to `scheduled_posts` with a `scheduled_at` timestamp and `status = 'pending'`. Nothing currently scans for due posts and publishes them. The `/cron/execute-post` endpoint exists to publish a specific post by ID, but requires the caller to know which IDs are due.

## Goal

Every 30 minutes, cron-job.org triggers a scan of due posts and executes each one -- with no new endpoints, no new infrastructure.

## Approach

Extend the existing `POST /cron/execute-post` endpoint to handle two modes:

- **With `{ postId: number }` body** -- existing behavior, executes a specific post. Kept for manual testing.
- **No body (scan mode)** -- queries for all `status = 'pending' AND scheduled_at <= NOW()` posts and executes each sequentially.

cron-job.org calls the endpoint with no body every 30 minutes.

## Changes

### `src/db.ts`

Add one new query:

```ts
getPostsDue(): Promise<{ id: number }[]>
```

Selects `id` from `scheduled_posts` where `status = 'pending' AND scheduled_at <= NOW()`. Returns only IDs -- execution logic stays in the route.

### `src/index.ts` — `/cron/execute-post`

Split behavior at the top of the handler based on whether `postId` is present in the parsed body:

**Scan mode (no postId):**
1. Call `getPostsDue()` to fetch due post IDs
2. For each ID, call `claimPost(id)` -- if `null`, already claimed, skip
3. For each claimed post, call `publishTweet` + `markPublished` or `markFailed`
4. Execute sequentially to avoid X rate limit issues
5. Return `{ ok: true, processed: N, skipped: M, failed: [{ id, error }] }`

**Single-post mode (postId present):**
Unchanged from current behavior.

## Idempotency

`claimPost` does an atomic `UPDATE ... WHERE status = 'pending'`, so concurrent or duplicate cron fires claim nothing and skip cleanly. No additional locking needed.

## Edge Cases

- **Nothing due:** `getPostsDue()` returns `[]`, handler returns `{ ok: true, processed: 0, skipped: 0, failed: [] }` immediately.
- **Thread posts:** Already handled -- `markFailed` with "Thread publishing not yet implemented". No change.
- **Stuck `processing` posts:** Posts that crash mid-execution stay `processing` forever. Pre-existing issue, out of scope.
- **X rate limit:** Sequential execution reduces risk. No retry logic added -- failed posts get `status = 'failed'` with error message.

## cron-job.org Configuration

- **URL:** `POST https://<vercel-url>/cron/execute-post`
- **Headers:** `x-cron-secret: <CRON_SECRET>`, `Content-Type: application/json`
- **Body:** empty
- **Schedule:** every 30 minutes
- **Timeout:** 30s

## Files Changed

| File | Change |
|------|--------|
| `src/db.ts` | Add `getPostsDue()` |
| `src/index.ts` | Extend `/cron/execute-post` with scan mode |

No new files. No new routes. No schema changes.

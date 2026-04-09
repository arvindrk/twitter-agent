import { eq, and, lte, sql } from "drizzle-orm";
import { db } from "./client.js";
import { scheduledPosts, type NewScheduledPost, type ScheduledPost } from "./schema.js";

export type PostInsert = Pick<
  NewScheduledPost,
  "content" | "type" | "scheduledAt" | "slot" | "rationale"
>;

/**
 * Bulk-insert scheduled posts. Returns the created rows (with DB ids).
 */
export async function insertScheduledPosts(
  posts: PostInsert[],
): Promise<Pick<ScheduledPost, "id">[]> {
  return db.insert(scheduledPosts).values(posts).returning({ id: scheduledPosts.id });
}

/**
 * Atomic CAS: transitions `pending → processing`.
 * Returns the claimed row or null if already claimed/not found.
 */
export async function claimPost(id: number): Promise<ScheduledPost | null> {
  const rows = await db
    .update(scheduledPosts)
    .set({ status: "processing" })
    .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.status, "pending")))
    .returning();
  return rows[0] ?? null;
}

/**
 * Transitions `processing → published` and records tweet metadata.
 */
export async function markPublished(
  id: number,
  tweetId: string,
  tweetUrl: string,
): Promise<void> {
  await db
    .update(scheduledPosts)
    .set({ status: "published", tweetId, tweetUrl, publishedAt: sql`NOW()` })
    .where(eq(scheduledPosts.id, id));
}

/**
 * Transitions `processing → failed` and stores the error message.
 */
export async function markFailed(id: number, error: string): Promise<void> {
  await db
    .update(scheduledPosts)
    .set({ status: "failed", error })
    .where(eq(scheduledPosts.id, id));
}

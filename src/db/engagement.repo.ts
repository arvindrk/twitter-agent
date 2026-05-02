import { eq } from "drizzle-orm";
import { db } from "./client.js";
import { engagementLog } from "./schema.js";

export async function claimEngagement(tweetId: string, eventType: string): Promise<boolean> {
  const rows = await db
    .insert(engagementLog)
    .values({ tweetId, eventType })
    .onConflictDoNothing()
    .returning({ tweetId: engagementLog.tweetId });
  return rows.length > 0;
}

export function markEngagementReplied(tweetId: string, replyTweetId: string, liked: boolean) {
  return db
    .update(engagementLog)
    .set({ status: "replied", replyTweetId, liked })
    .where(eq(engagementLog.tweetId, tweetId));
}

export function markEngagementSkipped(tweetId: string, skipReason: string, liked: boolean) {
  return db
    .update(engagementLog)
    .set({ status: "skipped", skipReason, liked })
    .where(eq(engagementLog.tweetId, tweetId));
}

export function markEngagementFailed(tweetId: string, error: string) {
  return db
    .update(engagementLog)
    .set({ status: "failed", error })
    .where(eq(engagementLog.tweetId, tweetId));
}

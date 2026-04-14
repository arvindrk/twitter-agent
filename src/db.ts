import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { pgTable, serial, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { eq, and, sql } from "drizzle-orm";

// ── Schema ────────────────────────────────────────────────────────────────────

const postTypeEnum = pgEnum("post_type", ["single", "thread"]);
const postStatusEnum = pgEnum("post_status", [
  "pending",
  "processing",
  "published",
  "failed",
]);
const timeSlotEnum = pgEnum("time_slot", [
  "morning",
  "lunch",
  "afternoon",
  "evening",
  "night",
]);

export const scheduledPosts = pgTable("scheduled_posts", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  type: postTypeEnum("type").notNull().default("single"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  slot: timeSlotEnum("slot").notNull(),
  rationale: text("rationale").notNull().default(""),
  status: postStatusEnum("status").notNull().default("pending"),
  tweetId: text("tweet_id"),
  tweetUrl: text("tweet_url"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

type ScheduledPost = typeof scheduledPosts.$inferSelect;

// ── Client ────────────────────────────────────────────────────────────────────

const db = drizzle(neon(process.env.DATABASE_URL!), {
  schema: { scheduledPosts },
});

// ── Queries ───────────────────────────────────────────────────────────────────

type PostInsert = Pick<
  typeof scheduledPosts.$inferInsert,
  "content" | "type" | "scheduledAt" | "slot" | "rationale"
>;

export function insertScheduledPosts(posts: PostInsert[]) {
  return db
    .insert(scheduledPosts)
    .values(posts)
    .returning({ id: scheduledPosts.id });
}

export async function claimPost(id: number): Promise<ScheduledPost | null> {
  const rows = await db
    .update(scheduledPosts)
    .set({ status: "processing" })
    .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.status, "pending")))
    .returning();
  return rows[0] ?? null;
}

export function markPublished(id: number, tweetId: string, tweetUrl: string) {
  return db
    .update(scheduledPosts)
    .set({ status: "published", tweetId, tweetUrl, publishedAt: sql`NOW()` })
    .where(eq(scheduledPosts.id, id));
}

export function markFailed(id: number, error: string) {
  return db
    .update(scheduledPosts)
    .set({ status: "failed", error })
    .where(eq(scheduledPosts.id, id));
}

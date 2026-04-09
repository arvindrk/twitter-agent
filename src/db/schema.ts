import { pgTable, serial, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const postTypeEnum = pgEnum("post_type", ["single", "thread"]);

export const postStatusEnum = pgEnum("post_status", [
  "pending",
  "processing",
  "published",
  "failed",
]);

export const timeSlotEnum = pgEnum("time_slot", [
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export type ScheduledPost = typeof scheduledPosts.$inferSelect;
export type NewScheduledPost = typeof scheduledPosts.$inferInsert;

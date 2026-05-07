import {
	pgTable,
	serial,
	text,
	timestamp,
	pgEnum,
	boolean,
	uniqueIndex,
} from "drizzle-orm/pg-core";

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
export const engagementStatusEnum = pgEnum("engagement_status", [
	"processing",
	"replied",
	"skipped",
	"failed",
]);
export const outboundActionEnum = pgEnum("outbound_action", [
	"like",
	"retweet",
	"reply",
	"follow",
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

export const engagementLog = pgTable("engagement_log", {
	tweetId: text("tweet_id").primaryKey(),
	eventType: text("event_type").notNull(),
	replyTweetId: text("reply_tweet_id"),
	status: engagementStatusEnum("status").notNull().default("processing"),
	liked: boolean("liked").notNull().default(false),
	skipReason: text("skip_reason"),
	error: text("error"),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const outboundEngagementLog = pgTable(
	"outbound_engagement_log",
	{
		id: serial("id").primaryKey(),
		tweetId: text("tweet_id").notNull(),
		authorId: text("author_id").notNull(),
		authorHandle: text("author_handle").notNull(),
		action: outboundActionEnum("action").notNull(),
		replyTweetId: text("reply_tweet_id"),
		error: text("error"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [uniqueIndex("outbound_uniq").on(t.tweetId, t.action)],
);

export type ScheduledPost = typeof scheduledPosts.$inferSelect;
export type EngagementLog = typeof engagementLog.$inferSelect;
export type OutboundEngagementLog = typeof outboundEngagementLog.$inferSelect;

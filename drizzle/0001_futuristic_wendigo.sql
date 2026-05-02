CREATE TYPE "public"."engagement_status" AS ENUM('processing', 'replied', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE "engagement_log" (
	"tweet_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"reply_tweet_id" text,
	"status" "engagement_status" DEFAULT 'processing' NOT NULL,
	"skip_reason" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

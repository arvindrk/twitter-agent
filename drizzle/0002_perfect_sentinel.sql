CREATE TYPE "public"."outbound_action" AS ENUM('like', 'retweet', 'reply', 'follow');--> statement-breakpoint
CREATE TABLE "outbound_engagement_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"tweet_id" text NOT NULL,
	"author_id" text NOT NULL,
	"author_handle" text NOT NULL,
	"action" "outbound_action" NOT NULL,
	"reply_tweet_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "engagement_log" ADD COLUMN "liked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_uniq" ON "outbound_engagement_log" USING btree ("tweet_id","action");
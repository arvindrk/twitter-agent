CREATE TYPE "public"."post_status" AS ENUM('pending', 'processing', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."post_type" AS ENUM('single', 'thread');--> statement-breakpoint
CREATE TYPE "public"."time_slot" AS ENUM('morning', 'lunch', 'afternoon', 'evening', 'night');--> statement-breakpoint
CREATE TABLE "scheduled_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"type" "post_type" DEFAULT 'single' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"slot" time_slot NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"status" "post_status" DEFAULT 'pending' NOT NULL,
	"tweet_id" text,
	"tweet_url" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);

import { eq, and, sql } from "drizzle-orm";
import { db } from "./client.js";
import { scheduledPosts, type ScheduledPost } from "./schema.js";

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
		.where(
			and(
				eq(scheduledPosts.id, id),
				eq(scheduledPosts.status, "pending"),
			),
		)
		.returning();
	return rows[0] ?? null;
}

export function markPublished(id: number, tweetId: string, tweetUrl: string) {
	return db
		.update(scheduledPosts)
		.set({
			status: "published",
			tweetId,
			tweetUrl,
			publishedAt: sql`NOW()`,
		})
		.where(eq(scheduledPosts.id, id));
}

export function markFailed(id: number, error: string) {
	return db
		.update(scheduledPosts)
		.set({ status: "failed", error })
		.where(eq(scheduledPosts.id, id));
}

export function resetStalePosts() {
	return db
		.update(scheduledPosts)
		.set({ status: "pending" })
		.where(
			and(
				eq(scheduledPosts.status, "processing"),
				sql`${scheduledPosts.scheduledAt} < NOW() - INTERVAL '10 minutes'`,
			),
		);
}

export function getPostsDue(): Promise<{ id: number }[]> {
	return db
		.select({ id: scheduledPosts.id })
		.from(scheduledPosts)
		.where(
			and(
				eq(scheduledPosts.status, "pending"),
				sql`${scheduledPosts.scheduledAt} <= NOW()`,
			),
		)
		.orderBy(scheduledPosts.scheduledAt)
		.limit(10);
}

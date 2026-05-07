import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "./client.js";
import { outboundEngagementLog } from "./schema.js";

export async function getAlreadyActedPairs(
	tweetIds: string[],
	actions: ("like" | "retweet" | "reply" | "follow")[],
): Promise<Set<string>> {
	if (tweetIds.length === 0 || actions.length === 0) return new Set();
	const rows = await db
		.select({
			tweetId: outboundEngagementLog.tweetId,
			action: outboundEngagementLog.action,
		})
		.from(outboundEngagementLog)
		.where(
			and(
				inArray(outboundEngagementLog.tweetId, tweetIds),
				inArray(sql`${outboundEngagementLog.action}::text`, actions),
			),
		);
	return new Set(rows.map((r) => `${r.tweetId}:${r.action}`));
}

export async function getCooledDownAuthorIds(
	authorIds: string[],
	windowHours: number,
): Promise<Set<string>> {
	if (authorIds.length === 0) return new Set();
	const rows = await db
		.select({ authorId: outboundEngagementLog.authorId })
		.from(outboundEngagementLog)
		.where(
			and(
				inArray(outboundEngagementLog.authorId, authorIds),
				inArray(sql`${outboundEngagementLog.action}::text`, [
					"reply",
					"follow",
				]),
				gt(
					outboundEngagementLog.createdAt,
					sql`now() - (${windowHours} * interval '1 hour')`,
				),
			),
		);
	return new Set(rows.map((r) => r.authorId));
}

export async function getFollowedAuthorIds(
	authorIds: string[],
): Promise<Set<string>> {
	if (authorIds.length === 0) return new Set();
	const rows = await db
		.select({ authorId: outboundEngagementLog.authorId })
		.from(outboundEngagementLog)
		.where(
			and(
				inArray(outboundEngagementLog.authorId, authorIds),
				eq(sql`${outboundEngagementLog.action}::text`, "follow"),
			),
		);
	return new Set(rows.map((r) => r.authorId));
}

export async function logOutboundAction(row: {
	tweetId: string;
	authorId: string;
	authorHandle: string;
	action: "like" | "retweet" | "reply" | "follow";
	replyTweetId?: string;
	error?: string;
}): Promise<void> {
	await db.insert(outboundEngagementLog).values(row).onConflictDoNothing();
}

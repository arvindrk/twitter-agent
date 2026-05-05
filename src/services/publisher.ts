import {
	claimPost,
	markPublished,
	markFailed,
	getPostsDue,
	resetStalePosts,
} from "../db/posts.repo.js";
import { publishTweet } from "../x/api.js";
import type { ScheduledPost } from "../db/schema.js";

const THREAD_NOT_SUPPORTED = "Thread publishing not yet implemented";

type PublishSuccess = {
	ok: true;
	status: "published";
	tweetId: string;
	tweetUrl: string;
};
type PublishSkipped = { ok: true; status: "skipped" };
type PublishFailure = { ok: false; error: string; httpStatus: 500 | 501 };

type SinglePostResult = PublishSuccess | PublishSkipped | PublishFailure;

type ScanResult = {
	processed: number;
	skipped: number;
	failed: { id: number; error: string }[];
};

async function execPublish(
	post: ScheduledPost,
): Promise<Omit<PublishSuccess, "status"> | PublishFailure> {
	if (post.type === "thread") {
		await markFailed(post.id, THREAD_NOT_SUPPORTED);
		return { ok: false, error: THREAD_NOT_SUPPORTED, httpStatus: 501 };
	}
	try {
		const result = await publishTweet(post.content);
		const tweetUrl = `https://x.com/i/web/status/${result.id}`;
		await markPublished(post.id, result.id, tweetUrl);
		console.log(`[publisher] post ${post.id} → tweet ${result.id}`);
		return { ok: true, tweetId: result.id, tweetUrl };
	} catch (err: unknown) {
		const error = err instanceof Error ? err.message : String(err);
		await markFailed(post.id, error);
		return { ok: false, error, httpStatus: 500 };
	}
}

export async function publishSinglePost(
	postId: number,
): Promise<SinglePostResult> {
	console.log(`[publisher] claiming post ${postId}`);
	const post = await claimPost(postId);
	if (!post) return { ok: true, status: "skipped" };
	const result = await execPublish(post);
	if (!result.ok) return result;
	return { ...result, status: "published" };
}

export async function publishDuePosts(): Promise<ScanResult> {
	await resetStalePosts();
	const due = await getPostsDue();
	console.log(`[publisher] scan — ${due.length} due post(s)`);

	let processed = 0;
	let skipped = 0;
	const failed: { id: number; error: string }[] = [];

	for (const { id } of due) {
		const post = await claimPost(id);
		if (!post) {
			skipped++;
			continue;
		}
		const result = await execPublish(post);
		if (result.ok) {
			processed++;
		} else {
			failed.push({ id, error: result.error });
		}
	}

	return { processed, skipped, failed };
}

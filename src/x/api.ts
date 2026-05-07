import { xClient } from "./client.js";

export interface ThreadNode {
	handle: string;
	text: string;
}

export interface SearchedTweet {
	tweetId: string;
	authorId: string;
	authorHandle: string;
	text: string;
	likeCount: number;
	retweetCount: number;
	authorFollowerCount: number;
}

type XApiResponse = { data?: { id?: string } };

type TwitterApiData = {
	data?: { text: string; referenced_tweets?: { type: string; id: string }[] };
	includes?: { users?: { username: string }[] };
};

type SearchRecentData = {
	data?: Array<{
		id: string;
		text: string;
		publicMetrics?: { likeCount: number; retweetCount: number };
		authorId?: string;
	}>;
	includes?: {
		users?: Array<{
			id: string;
			username: string;
			publicMetrics?: { followersCount: number };
		}>;
	};
};

function validateText(text: string, label: string): void {
	if (!text.trim()) throw new Error(`${label} cannot be empty`);
	if (text.length > 280)
		throw new Error(`${label} exceeds 280 chars (${text.length})`);
}

function extractId(response: unknown): string {
	const id = (response as XApiResponse)?.data?.id;
	if (!id)
		throw new Error(
			`X API returned no tweet id: ${JSON.stringify(response)}`,
		);
	return id;
}

export async function publishTweet(text: string): Promise<{ id: string }> {
	validateText(text, "Tweet text");
	console.log(`[x] Publishing tweet (${text.length} chars)...`);
	const id = extractId(await xClient.posts.create({ text }));
	console.log(`[x] Published tweet ${id}`);
	return { id };
}

export async function replyToTweet(
	inReplyToTweetId: string,
	text: string,
): Promise<{ id: string }> {
	validateText(text, "Reply text");
	console.log(
		`[x] Replying to ${inReplyToTweetId} (${text.length} chars)...`,
	);
	const id = extractId(
		await xClient.posts.create({
			text,
			reply: { in_reply_to_tweet_id: inReplyToTweetId },
		} as Parameters<typeof xClient.posts.create>[0]),
	);
	console.log(`[x] Reply posted: ${id}`);
	return { id };
}

export async function likeTweet(tweetId: string): Promise<void> {
	const userId = process.env.X_USER_ID;
	if (!userId) throw new Error("Missing env var: X_USER_ID");
	console.log(`[x] Liking tweet ${tweetId}...`);
	await xClient.users.likePost(userId, { body: { tweetId } } as Parameters<
		typeof xClient.users.likePost
	>[1]);
	console.log(`[x] Liked tweet ${tweetId}`);
}

export async function searchTweets(
	query: string,
	maxResults = 10,
): Promise<SearchedTweet[]> {
	try {
		console.log(`[x] Searching tweets: "${query}" (max ${maxResults})...`);
		const raw = await xClient.posts.searchRecent(query, {
			query: {
				expansions: "author_id",
				"user.fields": "username,public_metrics",
				"tweet.fields": "public_metrics",
				max_results: maxResults,
			},
		} as Parameters<typeof xClient.posts.searchRecent>[1]);
		const data = raw as SearchRecentData;
		const users = data.includes?.users ?? [];
		const userMap = new Map(users.map((u) => [u.id, u]));
		return (data.data ?? []).map((tweet) => {
			const author = userMap.get(tweet.authorId ?? "");
			return {
				tweetId: tweet.id,
				authorId: tweet.authorId ?? "",
				authorHandle: author?.username ?? "",
				text: tweet.text,
				likeCount: tweet.publicMetrics?.likeCount ?? 0,
				retweetCount: tweet.publicMetrics?.retweetCount ?? 0,
				authorFollowerCount: author?.publicMetrics?.followersCount ?? 0,
			};
		});
	} catch {
		return [];
	}
}

export async function followUser(targetUserId: string): Promise<void> {
	const userId = process.env.X_USER_ID;
	if (!userId) throw new Error("Missing env var: X_USER_ID");
	console.log(`[x] Following user ${targetUserId}...`);
	await xClient.users.followUser(userId, {
		body: { targetUserId },
	} as Parameters<typeof xClient.users.followUser>[1]);
	console.log(`[x] Followed user ${targetUserId}`);
}

export async function retweetPost(tweetId: string): Promise<void> {
	const userId = process.env.X_USER_ID;
	if (!userId) throw new Error("Missing env var: X_USER_ID");
	console.log(`[x] Retweeting tweet ${tweetId}...`);
	await xClient.users.repostPost(userId, { body: { tweetId } } as Parameters<
		typeof xClient.users.repostPost
	>[1]);
	console.log(`[x] Retweeted tweet ${tweetId}`);
}

export async function getFollowingHandles(limit = 100): Promise<string[]> {
	const userId = process.env.X_USER_ID;
	if (!userId) return [];
	try {
		console.log(`[x] Fetching following list (limit ${limit})...`);
		const raw = await xClient.users.getFollowing(userId, {
			query: { max_results: limit },
		} as Parameters<typeof xClient.users.getFollowing>[1]);
		const data = raw as { data?: Array<{ username: string }> };
		return (data.data ?? []).map((u) => u.username);
	} catch {
		return [];
	}
}

export async function fetchThreadContext(
	parentId: string | null,
	depth = 2,
): Promise<ThreadNode[]> {
	if (!parentId || depth === 0) return [];
	const bearerToken = process.env.X_BEARER_TOKEN;
	if (!bearerToken) return [];

	try {
		const url = new URL(`https://api.x.com/2/tweets/${parentId}`);
		url.searchParams.set("expansions", "author_id");
		url.searchParams.set("user.fields", "username");
		url.searchParams.set("tweet.fields", "text,referenced_tweets");

		const res = await fetch(url.toString(), {
			headers: { Authorization: `Bearer ${bearerToken}` },
		});
		if (!res.ok) return [];

		const data = (await res.json()) as TwitterApiData;
		const tweet = data.data;
		const author = data.includes?.users?.[0];
		if (!tweet || !author) return [];

		const current: ThreadNode = {
			handle: author.username,
			text: tweet.text,
		};
		const grandparentId =
			tweet.referenced_tweets?.find((r) => r.type === "replied_to")?.id ??
			null;

		return [
			...(await fetchThreadContext(grandparentId, depth - 1)),
			current,
		];
	} catch {
		return [];
	}
}

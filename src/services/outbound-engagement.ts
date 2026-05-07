import {
	searchTweets,
	followUser,
	retweetPost,
	getFollowingHandles,
	likeTweet,
	replyToTweet,
} from "../x/api.js";
import {
	getAlreadyActedPairs,
	getCooledDownAuthorIds,
	getFollowedAuthorIds,
	logOutboundAction,
} from "../db/outbound-engagement.repo.js";
import { runOutboundEngagementAgent } from "../agents/outbound-engagement.js";
import type { SearchedTweet } from "../x/index.js";
import type { OutboundDecision } from "../agents/outbound-engagement.js";

type CandidateTweet = SearchedTweet & { alreadyFollowing: boolean };

const STATIC_QUERIES = [
	'(LLM OR "AI agent" OR inference) -is:retweet lang:en min_faves:10',
	'("how do" OR "why does" OR "anyone tried") (GPT OR Claude OR Gemini OR LLM) -is:retweet lang:en',
	'("fine-tuning" OR RAG OR agentic OR "context window") -is:retweet lang:en min_faves:5',
];

const CAPS = { likes: 10, replies: 5, retweets: 3, follows: 3 };

function meetsSignalThreshold(tweet: SearchedTweet): boolean {
	return (
		tweet.likeCount >= 10 &&
		tweet.authorFollowerCount >= 100 &&
		tweet.authorFollowerCount <= 500_000
	);
}

function applyConstraints(
	decisions: OutboundDecision[],
	cooldownAuthorIds: Set<string>,
	followedAuthorIds: Set<string>,
	caps: typeof CAPS,
): OutboundDecision[] {
	let likes = 0,
		replies = 0,
		retweets = 0,
		follows = 0;
	return decisions.map((d) => {
		const onCooldown = cooldownAuthorIds.has(d.authorId);
		const alreadyFollowed = followedAuthorIds.has(d.authorId);
		const like = d.like && likes < caps.likes ? (likes++, true) : false;
		const retweet =
			d.retweet && retweets < caps.retweets ? (retweets++, true) : false;
		const reply =
			d.reply !== null && !onCooldown && replies < caps.replies
				? (replies++, d.reply)
				: null;
		const follow =
			d.follow &&
			!onCooldown &&
			!alreadyFollowed &&
			follows < caps.follows
				? (follows++, true)
				: false;
		return { ...d, like, retweet, reply, follow };
	});
}

function shuffle<T>(arr: T[]): T[] {
	const out = [...arr];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

export async function runOutboundEngagement(): Promise<{
	liked: number;
	retweeted: number;
	replied: number;
	followed: number;
	skipped: number;
}> {
	console.log("[outbound-engagement] starting run");

	// Step 1: parallel fetch
	const [results0, results1, results2, followingHandles] = await Promise.all([
		searchTweets(STATIC_QUERIES[0], 15),
		searchTweets(STATIC_QUERIES[1], 15),
		searchTweets(STATIC_QUERIES[2], 15),
		getFollowingHandles(100),
	]);
	console.log(
		`[outbound-engagement] static searches done — q0=${results0.length} q1=${results1.length} q2=${results2.length} following=${followingHandles.length}`,
	);

	// Step 2: seed query from following handles
	const seedResults =
		followingHandles.length === 0
			? []
			: await searchTweets(
					`(${shuffle(followingHandles)
						.slice(0, 5)
						.map((h) => `@${h}`)
						.join(" OR ")}) -is:retweet lang:en`,
					10,
				);
	console.log(
		`[outbound-engagement] seed search done — count=${seedResults.length}`,
	);

	// Step 3: dedup by tweetId
	const seen = new Map<string, SearchedTweet>();
	for (const tweet of [
		...results0,
		...results1,
		...results2,
		...seedResults,
	]) {
		if (!seen.has(tweet.tweetId)) seen.set(tweet.tweetId, tweet);
	}

	// Step 4: signal filter
	const candidates = [...seen.values()].filter(meetsSignalThreshold);
	console.log(
		`[outbound-engagement] after dedup+filter — total=${seen.size} candidates=${candidates.length}`,
	);

	// Step 5: early exit
	if (candidates.length === 0) {
		console.log("[outbound-engagement] no candidates, exiting");
		return { liked: 0, retweeted: 0, replied: 0, followed: 0, skipped: 0 };
	}

	// Step 6: batch DB queries
	const tweetIds = candidates.map((c) => c.tweetId);
	const authorIds = candidates.map((c) => c.authorId);
	const [actedPairs, cooldownIds, followedIds] = await Promise.all([
		getAlreadyActedPairs(tweetIds, ["like", "retweet", "reply", "follow"]),
		getCooledDownAuthorIds(authorIds, 6),
		getFollowedAuthorIds(authorIds),
	]);
	console.log(
		`[outbound-engagement] db done — acted=${actedPairs.size} cooldown=${cooldownIds.size} followed=${followedIds.size}`,
	);

	// Step 7: filter fully-acted candidates and mark alreadyFollowing
	const candidatesWithFollowing: CandidateTweet[] = candidates
		.filter(
			(c) =>
				!(
					actedPairs.has(`${c.tweetId}:like`) &&
					actedPairs.has(`${c.tweetId}:retweet`) &&
					actedPairs.has(`${c.tweetId}:reply`) &&
					actedPairs.has(`${c.tweetId}:follow`)
				),
		)
		.map((c) => ({ ...c, alreadyFollowing: followedIds.has(c.authorId) }));

	// Step 8: early exit
	if (candidatesWithFollowing.length === 0) {
		console.log(
			"[outbound-engagement] all candidates already acted on, exiting",
		);
		return { liked: 0, retweeted: 0, replied: 0, followed: 0, skipped: 0 };
	}

	// Step 9: call agent
	console.log(
		`[outbound-engagement] calling agent with ${candidatesWithFollowing.length} candidates`,
	);
	const rawDecisions = await runOutboundEngagementAgent(
		candidatesWithFollowing,
	);

	// Step 10: apply constraints
	const decisions = applyConstraints(
		rawDecisions,
		cooldownIds,
		followedIds,
		CAPS,
	);

	// Step 11: execute actions
	let liked = 0,
		retweeted = 0,
		replied = 0,
		followed = 0,
		skipped = 0;

	for (const d of decisions) {
		let anyAction = false;

		if (d.like && !actedPairs.has(`${d.tweetId}:like`)) {
			try {
				await likeTweet(d.tweetId);
				await logOutboundAction({
					tweetId: d.tweetId,
					authorId: d.authorId,
					authorHandle: d.authorHandle,
					action: "like",
				});
				liked++;
				anyAction = true;
			} catch (err) {
				await logOutboundAction({
					tweetId: d.tweetId,
					authorId: d.authorId,
					authorHandle: d.authorHandle,
					action: "like",
					error: String(err),
				});
			}
		}

		if (d.retweet && !actedPairs.has(`${d.tweetId}:retweet`)) {
			try {
				await retweetPost(d.tweetId);
				await logOutboundAction({
					tweetId: d.tweetId,
					authorId: d.authorId,
					authorHandle: d.authorHandle,
					action: "retweet",
				});
				retweeted++;
				anyAction = true;
			} catch (err) {
				await logOutboundAction({
					tweetId: d.tweetId,
					authorId: d.authorId,
					authorHandle: d.authorHandle,
					action: "retweet",
					error: String(err),
				});
			}
		}

		if (d.reply !== null && !actedPairs.has(`${d.tweetId}:reply`)) {
			try {
				const result = await replyToTweet(d.tweetId, d.reply.content);
				await logOutboundAction({
					tweetId: d.tweetId,
					authorId: d.authorId,
					authorHandle: d.authorHandle,
					action: "reply",
					replyTweetId: result.id,
				});
				replied++;
				anyAction = true;
			} catch (err) {
				await logOutboundAction({
					tweetId: d.tweetId,
					authorId: d.authorId,
					authorHandle: d.authorHandle,
					action: "reply",
					error: String(err),
				});
			}
		}

		if (d.follow && !actedPairs.has(`${d.tweetId}:follow`)) {
			try {
				await followUser(d.authorId);
				await logOutboundAction({
					tweetId: d.tweetId,
					authorId: d.authorId,
					authorHandle: d.authorHandle,
					action: "follow",
				});
				followed++;
				anyAction = true;
			} catch (err) {
				await logOutboundAction({
					tweetId: d.tweetId,
					authorId: d.authorId,
					authorHandle: d.authorHandle,
					action: "follow",
					error: String(err),
				});
			}
		}

		if (!anyAction) skipped++;
	}

	// Step 12: log and return
	console.log(
		`[outbound-engagement] → liked=${liked} retweeted=${retweeted} replied=${replied} followed=${followed} skipped=${skipped}`,
	);
	return { liked, retweeted, replied, followed, skipped };
}

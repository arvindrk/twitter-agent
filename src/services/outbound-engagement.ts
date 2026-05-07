import { getHomeFeed, followUser, retweetPost, likeTweet } from "../x/api.js";
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
type EnrichedDecision = OutboundDecision & {
	authorId: string;
	authorHandle: string;
};

const CAPS = { likes: 10, retweets: 3, follows: 3 };

function meetsSignalThreshold(tweet: SearchedTweet): boolean {
	return (
		tweet.likeCount >= 10 &&
		tweet.authorFollowerCount >= 100 &&
		tweet.authorFollowerCount <= 500_000
	);
}

function applyConstraints(
	decisions: EnrichedDecision[],
	cooldownAuthorIds: Set<string>,
	followedAuthorIds: Set<string>,
	caps: typeof CAPS,
): EnrichedDecision[] {
	let likes = 0,
		retweets = 0,
		follows = 0;
	return decisions.map((d) => {
		const onCooldown = cooldownAuthorIds.has(d.authorId);
		const alreadyFollowed = followedAuthorIds.has(d.authorId);
		const like = d.like && likes < caps.likes ? (likes++, true) : false;
		const retweet =
			d.retweet && retweets < caps.retweets ? (retweets++, true) : false;
		const follow =
			d.follow &&
			!onCooldown &&
			!alreadyFollowed &&
			follows < caps.follows
				? (follows++, true)
				: false;
		return { ...d, like, retweet, follow };
	});
}

export async function runOutboundEngagement(): Promise<{
	liked: number;
	retweeted: number;
	followed: number;
	skipped: number;
}> {
	console.log("[outbound-engagement] starting run");

	// Step 1: fetch home feed
	const feedTweets = await getHomeFeed(100);
	console.log(
		`[outbound-engagement] home feed fetched — count=${feedTweets.length}`,
	);

	// Step 2: dedup by tweetId
	const seen = new Map<string, SearchedTweet>();
	for (const tweet of feedTweets) {
		if (!seen.has(tweet.tweetId)) seen.set(tweet.tweetId, tweet);
	}

	// Step 3: signal filter
	const candidates = [...seen.values()].filter(meetsSignalThreshold);
	console.log(
		`[outbound-engagement] after dedup+filter — total=${seen.size} candidates=${candidates.length}`,
	);

	// Step 4: early exit
	if (candidates.length === 0) {
		console.log("[outbound-engagement] no candidates, exiting");
		return { liked: 0, retweeted: 0, followed: 0, skipped: 0 };
	}

	// Step 5: batch DB queries
	const tweetIds = candidates.map((c) => c.tweetId);
	const authorIds = candidates.map((c) => c.authorId);
	const [actedPairs, cooldownIds, followedIds] = await Promise.all([
		getAlreadyActedPairs(tweetIds, ["like", "retweet", "follow"]),
		getCooledDownAuthorIds(authorIds, 6),
		getFollowedAuthorIds(authorIds),
	]);
	console.log(
		`[outbound-engagement] db done — acted=${actedPairs.size} cooldown=${cooldownIds.size} followed=${followedIds.size}`,
	);

	// Step 6: filter fully-acted candidates and mark alreadyFollowing
	const candidatesWithFollowing: CandidateTweet[] = candidates
		.filter(
			(c) =>
				!(
					actedPairs.has(`${c.tweetId}:like`) &&
					actedPairs.has(`${c.tweetId}:retweet`) &&
					actedPairs.has(`${c.tweetId}:follow`)
				),
		)
		.map((c) => ({ ...c, alreadyFollowing: followedIds.has(c.authorId) }));

	// Step 7: early exit
	if (candidatesWithFollowing.length === 0) {
		console.log(
			"[outbound-engagement] all candidates already acted on, exiting",
		);
		return { liked: 0, retweeted: 0, followed: 0, skipped: 0 };
	}

	// Step 8: call agent — guard against transient xAI outages
	console.log(
		`[outbound-engagement] calling agent with ${candidatesWithFollowing.length} candidates`,
	);
	let rawDecisions: OutboundDecision[];
	try {
		rawDecisions = await runOutboundEngagementAgent(
			candidatesWithFollowing,
		);
	} catch (err) {
		console.warn(
			"[outbound-engagement] agent unavailable, aborting run:",
			err instanceof Error ? err.message : err,
		);
		return { liked: 0, retweeted: 0, followed: 0, skipped: 0 };
	}

	// Step 9: enrich decisions with authorId/authorHandle from candidates (never trust LLM for these)
	const candidateMap = new Map(
		candidatesWithFollowing.map((c) => [c.tweetId, c]),
	);
	const enrichedDecisions: EnrichedDecision[] = rawDecisions.map((d) => {
		const candidate = candidateMap.get(d.tweetId);
		return {
			...d,
			authorId: candidate?.authorId ?? "",
			authorHandle: candidate?.authorHandle ?? "",
		};
	});

	// Step 10: apply constraints
	const decisions = applyConstraints(
		enrichedDecisions,
		cooldownIds,
		followedIds,
		CAPS,
	);

	// Step 11: execute actions
	let liked = 0,
		retweeted = 0,
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
				console.warn(
					`[outbound-engagement] follow failed @${d.authorHandle} (${d.authorId}):`,
					err,
				);
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
		`[outbound-engagement] → liked=${liked} retweeted=${retweeted} followed=${followed} skipped=${skipped}`,
	);
	return { liked, retweeted, followed, skipped };
}

import {
	claimEngagement,
	markEngagementReplied,
	markEngagementSkipped,
	markEngagementFailed,
} from "../db/engagement.repo.js";
import { replyToTweet, likeTweet, fetchThreadContext } from "../x/api.js";
import { runInboundEngagementAgent } from "../agents/inbound-engagement.js";

interface XTweetEvent {
	id_str: string;
	text: string;
	user: { id_str: string; screen_name: string };
	in_reply_to_status_id_str: string | null;
	in_reply_to_user_id_str: string | null;
	is_quote_status: boolean;
	entities?: { user_mentions?: { id_str: string; screen_name: string }[] };
}

export interface XWebhookPayload {
	for_user_id: string;
	tweet_create_events?: XTweetEvent[];
}

const SEP = "─".repeat(50);

export async function processEngagementEvent(
	payload: XWebhookPayload,
): Promise<void> {
	const events = payload.tweet_create_events;
	if (!events?.length) return;

	const myUserId = process.env.X_USER_ID;
	if (!myUserId) {
		console.error("[engagement] X_USER_ID not set");
		return;
	}

	for (const tweet of events) {
		if (tweet.user.id_str === myUserId) continue;

		const isMention = tweet.entities?.user_mentions?.some(
			(m) => m.id_str === myUserId,
		);
		const isReplyToMe = tweet.in_reply_to_user_id_str === myUserId;
		if (!isMention && !isReplyToMe) continue;

		const eventType = isMention ? "mention" : "reply";

		console.log(`\n[engagement] ${SEP}`);
		console.log(
			`[engagement] tweet=${tweet.id_str} type=${eventType} from=@${tweet.user.screen_name}`,
		);
		const displayText =
			tweet.text.length > 100
				? `${tweet.text.slice(0, 97)}...`
				: tweet.text;
		console.log(`[engagement] text: "${displayText}"`);

		const claimed = await claimEngagement(tweet.id_str, eventType);
		if (!claimed) {
			console.log(`[engagement] already claimed, skipping`);
			console.log(`[engagement] ${SEP}\n`);
			continue;
		}

		try {
			const thread = await fetchThreadContext(
				tweet.in_reply_to_status_id_str,
			);
			if (thread.length > 0)
				console.log(`[engagement] thread: ${thread.length} node(s)`);

			const decision = await runInboundEngagementAgent({
				tweetId: tweet.id_str,
				authorHandle: tweet.user.screen_name,
				text: tweet.text,
				thread,
			});

			if (decision.like) {
				await likeTweet(tweet.id_str).catch((err: unknown) => {
					console.error(
						`[engagement] → like failed: ${err instanceof Error ? err.message : err}`,
					);
				});
			}

			if (decision.reply === null) {
				await markEngagementSkipped(
					tweet.id_str,
					decision.reason,
					decision.like,
				);
				console.log(
					`[engagement] → no reply (like=${decision.like}): ${decision.reason}`,
				);
				console.log(`[engagement] ${SEP}\n`);
				continue;
			}

			console.log(
				`[engagement] → reply stance=${decision.reply.stance} like=${decision.like}`,
			);
			console.log(`[engagement] → content: "${decision.reply.content}"`);
			const result = await replyToTweet(
				tweet.id_str,
				decision.reply.content,
			);
			await markEngagementReplied(tweet.id_str, result.id, decision.like);
			console.log(`[engagement] → posted reply ${result.id}`);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[engagement] → error: ${msg}`);
			await markEngagementFailed(tweet.id_str, msg).catch(
				(dbErr: unknown) => {
					console.error(
						`[engagement] → failed to mark failure: ${dbErr instanceof Error ? dbErr.message : dbErr}`,
					);
				},
			);
		}

		console.log(`[engagement] ${SEP}\n`);
	}
}

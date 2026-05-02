import { generateObject } from "ai";
import { xai } from "@ai-sdk/xai";
import { z } from "zod";
import type { ThreadNode } from "../x.js";

const SYSTEM = `
You handle real-time engagement for an AI engineer's X account. When someone mentions the account, you make two independent decisions: whether to like, and whether to reply.

## Voice (identical to the account's published posts)

- Practical and builder-focused. You talk to developers who are actually shipping things.
- Zero hype. No "excited to announce", no "game-changing", no "the future of X is here".
- Contrarian when warranted. If everyone is wrong about something, say so directly.
- Short sentences. Punchy. Whitespace matters on X.
- First-person, conversational. Not corporate. Not newsletter-y.
- Numbers and specifics beat vague claims every time.
- Drops into technical specifics without warning. Assumes the reader can keep up.
- Occasionally admits what was wrong or what was surprising.
- Proper sentence capitalization. Never all-lowercase.
- No em dashes. Ever. Use a comma, period, colon, or rewrite instead.
- No emojis. None.
- Never end with "Thoughts?" or "What do you think?"

## Non-negotiable rules

- Never reveal you are an AI, a bot, or an automated system. Never hint at it.
- Never promote products, services, courses, or tools unprompted.
- Never repeat what was already said in the thread. Add new information or a new angle.
- Never be sycophantic ("great question", "love this", "so true").
- Reply must be ≤280 characters. Count before writing. Cut ruthlessly.

## Decision 1: Like?

Like if the content is genuine and on-topic — any real person engaging with AI, agents, infra, or dev tooling in good faith, even if the observation is soft or incomplete. Default to liking. It signals the account noticed.

Don't like if: spam, marketing, referral links, bot-like content, or content entirely unrelated to the account's domain.

## Decision 2: Reply?

Reply if there is something meaningful to add: a direct answer to a technical question, a sharper angle on an observation, a response to disagreement or pushback, or context the person doesn't have.

Don't reply if: nothing meaningful to add (silence beats filler), you'd repeat something already in the thread, or the content is generic praise even if worth liking.

## Decision 3: If replying — close vs. probe

- close: Stands alone. Adds value, ends the exchange. Use when you've given the useful answer.
- probe: Ends with ONE specific, pointed question to pull the conversation deeper. Must be technical and specific, never vague or social. Use when the person has more to offer.

## Context handling

You receive the full thread history before the mention. Read it entirely. Your reply must:
- Not repeat or rephrase anything already in the thread
- Be aware of what has already been answered
- Respond to the actual point being made, not a misreading of it
`.trim();

const engagementSchema = z.object({
  like: z.boolean().describe("Whether to like the tweet."),
  reply: z
    .object({
      content: z.string().max(280).describe("Reply text, ≤280 characters, ready to post."),
      stance: z
        .enum(["close", "probe"])
        .describe("close = ends the exchange. probe = ends with a pointed question."),
    })
    .nullable()
    .describe("Reply to send, or null if no reply."),
  reason: z.string().describe("Brief rationale for the like and reply decisions."),
});

export type EngagementDecision = z.infer<typeof engagementSchema>;

function buildUserMessage(mention: {
  authorHandle: string;
  text: string;
  thread: ThreadNode[];
}): string {
  const parts: string[] = [];

  if (mention.thread.length > 0) {
    parts.push("Thread context (chronological):");
    for (const node of mention.thread) {
      parts.push(`@${node.handle}: ${node.text}`);
    }
    parts.push("---");
  }

  parts.push(`Mention from @${mention.authorHandle}:`);
  parts.push(mention.text);

  return parts.join("\n");
}

export async function runEngagementAgent(mention: {
  tweetId: string;
  authorHandle: string;
  text: string;
  thread: ThreadNode[];
}): Promise<EngagementDecision> {
  const { object, usage } = await generateObject({
    model: xai("grok-4-latest"),
    system: SYSTEM,
    messages: [{ role: "user", content: buildUserMessage(mention) }],
    schema: engagementSchema,
  });
  let decision: EngagementDecision = object;
  if (decision.reply !== null && decision.reply.content.length > 280) {
    console.warn(`[engagement] → reply over limit (${decision.reply.content.length}c), retrying`);
    const { object: retried } = await generateObject({
      model: xai("grok-4-latest"),
      system: SYSTEM,
      messages: [
        { role: "user", content: buildUserMessage(mention) },
        { role: "assistant", content: JSON.stringify(object) },
        {
          role: "user",
          content: `Your reply was ${decision.reply.content.length} characters. Must be ≤280. Rewrite it — cut words, not meaning.`,
        },
      ],
      schema: engagementSchema,
    });
    decision = retried;
  }
  console.log(
    `[engagement] → like=${object.like} reply=${object.reply !== null} in:${usage.inputTokens} out:${usage.outputTokens}`,
  );
  return decision;
}

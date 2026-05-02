import { Client, OAuth1 } from "@xdevplatform/xdk";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
};

const xClient = new Client({
  oauth1: new OAuth1({
    apiKey: env("X_API_KEY"),
    apiSecret: env("X_API_SECRET"),
    accessToken: env("X_ACCESS_TOKEN"),
    accessTokenSecret: env("X_ACCESS_TOKEN_SECRET"),
    callback: "oob",
  }),
});

function validateText(text: string, label: string): void {
  if (!text.trim()) throw new Error(`${label} cannot be empty`);
  if (text.length > 280) throw new Error(`${label} exceeds 280 chars (${text.length})`);
}

function extractId(response: unknown): string {
  const id = (response as any)?.data?.id as string | undefined;
  if (!id) throw new Error(`X API returned no tweet id: ${JSON.stringify(response)}`);
  return id;
}

export async function publishTweet(text: string): Promise<{ id: string }> {
  validateText(text, "Tweet text");
  console.log(`[x] Publishing tweet (${text.length} chars)...`);
  const response = await xClient.posts.create({ text });
  const id = extractId(response);
  console.log(`[x] Published tweet ${id}`);
  return { id };
}

export async function replyToTweet(
  inReplyToTweetId: string,
  text: string,
): Promise<{ id: string }> {
  validateText(text, "Reply text");
  console.log(`[x] Replying to ${inReplyToTweetId} (${text.length} chars)...`);
  const response = await xClient.posts.create({
    text,
    reply: { in_reply_to_tweet_id: inReplyToTweetId },
  } as Parameters<typeof xClient.posts.create>[0]);
  const id = extractId(response);
  console.log(`[x] Reply posted: ${id}`);
  return { id };
}

export async function likeTweet(tweetId: string): Promise<void> {
  const userId = process.env.X_USER_ID;
  if (!userId) throw new Error("Missing env var: X_USER_ID");
  console.log(`[x] Liking tweet ${tweetId}...`);
  await xClient.users.likePost(userId, { body: { tweetId } } as Parameters<typeof xClient.users.likePost>[1]);
  console.log(`[x] Liked tweet ${tweetId}`);
}

export interface ThreadNode {
  handle: string;
  text: string;
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

    const data = await res.json() as any;
    const tweet = data.data;
    const author = (data.includes?.users as any[])?.[0];
    if (!tweet || !author) return [];

    const current: ThreadNode = { handle: author.username, text: tweet.text };
    const grandparentId =
      (tweet.referenced_tweets as any[])?.find((r: any) => r.type === "replied_to")?.id ??
      null;

    const ancestors = await fetchThreadContext(grandparentId, depth - 1);
    return [...ancestors, current];
  } catch {
    return [];
  }
}

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

export async function publishTweet(text: string): Promise<{ id: string }> {
  if (!text.trim()) throw new Error("Tweet text cannot be empty");
  if (text.length > 280)
    throw new Error(`Tweet text exceeds 280 chars (${text.length})`);
  console.log(`[x] Publishing tweet (${text.length} chars)...`);
  const response = await xClient.posts.create({ text });
  const id = (response.data as any)?.id as string | undefined;
  if (!id)
    throw new Error(`X API returned no tweet id: ${JSON.stringify(response)}`);
  console.log(`[x] Published tweet ${id}`);
  return { id };
}

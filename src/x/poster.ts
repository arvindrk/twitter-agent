import { xClient } from "./client";

export interface PostResult {
  id: string;
  text: string;
}

export async function publishTweet(text: string): Promise<PostResult> {
  if (!text || text.trim().length === 0) {
    throw new Error("Tweet text cannot be empty");
  }
  if (text.length > 280) {
    throw new Error(`Tweet text exceeds 280 characters (got ${text.length})`);
  }

  console.log(`[x/poster] Publishing tweet (${text.length} chars)...`);

  const response = await xClient.posts.create({ text });

  const id = (response.data as any)?.id as string | undefined;
  if (!id) {
    throw new Error(
      `X API returned no tweet id. Response: ${JSON.stringify(response)}`,
    );
  }

  console.log(`[x/poster] Published tweet ${id}`);
  return { id, text };
}

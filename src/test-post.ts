/**
 * Standalone script to test tweet publishing directly (no server required).
 * Run: bun run test:post
 * Run with custom text: bun run test:post "your tweet text here"
 */

import { publishTweet } from "./x/poster";

const text = process.argv[2] ?? `test post from x-agent — ${new Date().toISOString()}`;

console.log(`Publishing tweet (${text.length} chars):\n"${text}"\n`);

publishTweet(text)
  .then((result) => {
    console.log("Published:", result);
  })
  .catch((err) => {
    console.error("Failed:", err.message);
    process.exit(1);
  });

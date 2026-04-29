import { publishTweet } from "./x.js";

const text =
  process.argv[2] ?? `test post from x-agent — ${new Date().toISOString()}`;
console.log(`Publishing (${text.length} chars): "${text}"\n`);

publishTweet(text)
  .then((r) => console.log("Published:", r))
  .catch((err) => {
    console.error("Failed:", err.message);
    process.exit(1);
  });

import { runDailyWorkflow } from "./pipeline.js";

const posts = await runDailyWorkflow();
const sorted = posts.sort(
  (a, b) =>
    new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
);

console.log(`\n${"=".repeat(60)}`);
console.log(`  SCHEDULED POSTS FOR TODAY (${new Date().toDateString()})`);
console.log(`${"=".repeat(60)}\n`);

for (const post of sorted) {
  const time = new Date(post.scheduledAt).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  console.log(
    `[${time} EST] [${post.slot}] Post ${post.postId} (${post.type})`,
  );
  console.log(`Rationale: ${post.rationale}`);
  console.log(`\n${post.content}\n`);
  console.log("-".repeat(60));
}

console.log(`\nTotal posts scheduled: ${posts.length}`);

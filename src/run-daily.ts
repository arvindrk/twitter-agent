/**
 * Standalone script to run the full daily workflow (research → write → schedule).
 * Run: bun run run:daily
 */

import { mastra } from "./mastra";

async function main() {
  console.log("Starting daily workflow...\n");

  const workflow = mastra.getWorkflow("dailyWorkflow");
  const run = await workflow.createRun();
  const result = await run.start({ inputData: {} });

  if (result.status !== "success") {
    console.error("Workflow failed:", result.status);
    if (result.status === "failed") console.error(result.error);
    process.exit(1);
  }

  const { scheduledPosts } = result.result;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  SCHEDULED POSTS FOR TODAY (${new Date().toDateString()})`);
  console.log(`${"=".repeat(60)}\n`);

  const sorted = [...scheduledPosts].sort(
    (a, b) =>
      new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  );

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
    console.log(`\n${post.content}`);
    console.log(`\n${"-".repeat(60)}\n`);
  }

  console.log(`Total posts scheduled: ${scheduledPosts.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

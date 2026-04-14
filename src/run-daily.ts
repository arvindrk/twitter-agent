/**
 * Standalone script to run the full daily workflow (research → write → schedule).
 * Run: bun src/run-daily.ts
 */

import { runDailyWorkflow } from './pipeline';

async function main() {
  console.log('Starting daily workflow...\n');

  const { scheduledPosts } = await runDailyWorkflow();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  SCHEDULED POSTS FOR TODAY (${new Date().toDateString()})`);
  console.log(`${'='.repeat(60)}\n`);

  const sorted = [...scheduledPosts].sort(
    (a, b) =>
      new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  );

  for (const post of sorted) {
    const time = new Date(post.scheduledAt).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/New_York',
    });
    console.log(
      `[${time} EST] [${post.slot}] Post ${post.postId} (${post.type})`,
    );
    console.log(`Rationale: ${post.rationale}`);
    console.log(`\n${post.content}`);
    console.log(`\n${'-'.repeat(60)}\n`);
  }

  console.log(`Total posts scheduled: ${scheduledPosts.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

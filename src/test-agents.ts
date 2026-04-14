/**
 * Test script for the three core X agent pipeline stages.
 * Run: bun src/test-agents.ts [researcher|writer|scheduler|all]
 *
 * Requires XAI_API_KEY in your .env
 */

import { runResearcher } from './agents/researcher-agent';
import { runWriter } from './agents/writer-agent';
import { runScheduler } from './agents/scheduler-agent';

const arg = process.argv[2] ?? 'all';

async function testResearcher() {
  console.log('\n=== RESEARCHER AGENT ===\n');
  const brief = await runResearcher(
    'Research trending AI topics on X and the web from the last 7 days. Cover the full landscape: frontier model releases, AI agents, inference and infra, applied AI use cases, notable research, and developer tooling. Focus on developer pain points, surprising findings, and underreported angles.',
  );
  console.log(brief);
  return brief;
}

async function testWriter(researchBrief?: string) {
  console.log('\n=== WRITER AGENT ===\n');
  const input =
    researchBrief ??
    `Here are some research findings to turn into posts:
- Claude 4 Opus is scoring surprisingly well on SWE-bench but developers report the gains don't transfer cleanly to their actual codebases
- Most teams running evals are measuring the wrong thing: they optimize for benchmark scores on clean prompts, then ship to messy real-world inputs
- Inference costs have dropped 10x in 18 months but most companies are still making architecture decisions based on 2023 pricing
- The "context window is all you need for memory" take is everywhere on X right now, and it's mostly wrong for anything stateful
- Mercor is seeing a surge in AI engineer hiring demand but the bar for what counts as "AI experience" is all over the place`;

  const { posts } = await runWriter(input);
  for (const post of posts) {
    console.log(`\n--- Post ${post.id} [${post.type}] ---`);
    console.log(post.content);
  }
  return posts;
}

async function testScheduler(posts?: Awaited<ReturnType<typeof testWriter>>) {
  console.log('\n=== SCHEDULER AGENT ===\n');
  const today = new Date().toISOString().split('T')[0];

  let userMessage: string;
  if (posts) {
    const formatted = posts.map((p) => `Post ${p.id} [${p.type}]:\n${p.content}`).join('\n\n');
    userMessage = `Today is ${today}. Here are ${posts.length} draft posts to schedule:\n\n${formatted}`;
  } else {
    userMessage = `Today is ${today}. Here are 4 draft posts to schedule:

Post 1 [single]: contrarian take on SWE-bench scores not translating to real codebases
Post 2 [thread]: why most teams are running evals wrong
Post 3 [single]: inference cost drop and what it means for architecture decisions made in 2023
Post 4 [single]: observation on the "context window as memory" misconception`;
  }

  const scheduleItems = await runScheduler(userMessage);
  for (const item of scheduleItems) {
    console.log(`  Post ${item.postId} → ${item.scheduledAt} [${item.slot}] — ${item.rationale}`);
  }
}

async function main() {
  if (arg === 'researcher') {
    await testResearcher();
  } else if (arg === 'writer') {
    await testWriter();
  } else if (arg === 'scheduler') {
    await testScheduler();
  } else {
    // Full pipeline: researcher → writer → scheduler
    const brief = await testResearcher();
    const posts = await testWriter(brief);
    await testScheduler(posts);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

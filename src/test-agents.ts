/**
 * Test script for the three core X agent pipeline stages.
 * Run: bun src/test-agents.ts [researcher|writer|scheduler|all]
 *
 * Requires XAI_API_KEY in your .env
 */

import { researcherAgent } from './mastra/agents/researcher-agent';
import { writerAgent } from './mastra/agents/writer-agent';
import { schedulerAgent } from './mastra/agents/scheduler-agent';

const arg = process.argv[2] ?? 'all';

async function testResearcher() {
  console.log('\n=== RESEARCHER AGENT ===\n');
  const result = await researcherAgent.generate([
    {
      role: 'user',
      content:
        'Research trending AI topics on X and the web from the last 7 days. Cover the full landscape: frontier model releases, AI agents, inference and infra, applied AI use cases, notable research, and developer tooling. Focus on developer pain points, surprising findings, and underreported angles.',
    },
  ]);
  console.log(result.text);
  return result.text;
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

  const result = await writerAgent.generate([
    {
      role: 'user',
      content: input,
    },
  ]);
  console.log(result.text);
  return result.text;
}

async function testScheduler(drafts?: string) {
  console.log('\n=== SCHEDULER AGENT ===\n');
  const today = new Date().toISOString().split('T')[0];
  const input =
    drafts ??
    `Today is ${today}. Here are 4 draft posts to schedule:

Post 1: Single post — contrarian take on SWE-bench scores not translating to real codebases
Post 2: Thread (3 tweets) — why most teams are running evals wrong
Post 3: Single post — inference cost drop and what it means for architecture decisions made in 2023
Post 4: Single post — observation on the "context window as memory" misconception`;

  const result = await schedulerAgent.generate([
    {
      role: 'user',
      content: input,
    },
  ]);

  console.log('Raw output:\n', result.text);

  // Parse and pretty-print the JSON schedule
  try {
    const schedule = JSON.parse(result.text);
    console.log('\nParsed schedule:');
    for (const item of schedule) {
      console.log(
        `  Post ${item.postId} → ${item.scheduledAt} [${item.slot}] — ${item.rationale}`,
      );
    }
  } catch {
    console.log('(Could not parse as JSON — model returned prose)');
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
    const research = await testResearcher();
    const drafts = await testWriter(research);
    await testScheduler(drafts);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

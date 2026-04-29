/**
 * Test the pipeline stages individually or end-to-end.
 * Usage: bun src/test-agents.ts [researcher|writer|scheduler|all]
 */

import { runResearcher } from "./agents/researcher.js";
import { runWriter } from "./agents/writer.js";
import { runScheduler } from "./agents/scheduler.js";

const arg = process.argv[2] ?? "all";
const today = new Date().toISOString().split("T")[0];

const SAMPLE_BRIEF = `Here are some research findings to turn into posts:
- Claude 4 Opus scores well on SWE-bench but developers report the gains don't transfer to real codebases
- Most teams running evals measure the wrong thing: benchmark scores on clean prompts, then ship to messy real-world inputs
- Inference costs have dropped 10x in 18 months but teams still make architecture decisions based on 2023 pricing
- The "context window as memory" take is mostly wrong for anything stateful
- AI engineer hiring demand is surging but the bar for "AI experience" varies wildly`;

const SAMPLE_POSTS = [
  {
    id: 1,
    type: "single" as const,
    content: "SWE-bench scores not translating to real codebases",
  },
  {
    id: 2,
    type: "thread" as const,
    content: "why most teams are running evals wrong",
  },
  {
    id: 3,
    type: "single" as const,
    content: "inference cost drop and outdated 2023 architecture decisions",
  },
  {
    id: 4,
    type: "single" as const,
    content: "context window as memory is mostly wrong for stateful apps",
  },
];

async function testResearcher() {
  console.log("\n=== RESEARCHER ===\n");
  const brief = await runResearcher(
    "Research trending AI topics on X and the web from the last 7 days. Cover frontier models, AI agents, infra, applied use cases, research, and developer tooling. Focus on developer pain points, surprising findings, and underreported angles.",
  );
  console.log(brief);
  return brief;
}

async function testWriter(brief?: string) {
  console.log("\n=== WRITER ===\n");
  const posts = await runWriter(brief ?? SAMPLE_BRIEF);
  for (const post of posts)
    console.log(`\n--- Post ${post.id} [${post.type}] ---\n${post.content}`);
  return posts;
}

async function testScheduler(posts?: typeof SAMPLE_POSTS) {
  console.log("\n=== SCHEDULER ===\n");
  const list = posts ?? SAMPLE_POSTS;
  const formatted = list
    .map((p) => `Post ${p.id} [${p.type}]:\n${p.content}`)
    .join("\n\n");
  const items = await runScheduler(
    `Today is ${today}. Here are ${list.length} draft posts to schedule:\n\n${formatted}`,
  );
  for (const item of items)
    console.log(
      `  Post ${item.postId} → ${item.scheduledAt} [${item.slot}] — ${item.rationale}`,
    );
}

if (arg === "researcher") {
  await testResearcher();
} else if (arg === "writer") {
  await testWriter();
} else if (arg === "scheduler") {
  await testScheduler();
} else {
  const brief = await testResearcher();
  const posts = await testWriter(brief);
  await testScheduler(posts);
}

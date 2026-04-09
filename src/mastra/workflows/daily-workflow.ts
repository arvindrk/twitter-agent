import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

// ── Schemas ──────────────────────────────────────────────────────────────────

const postSchema = z.object({
  id: z.number(),
  content: z
    .string()
    .describe(
      "Full post text, ready to publish. For threads, each tweet separated by \\n---\\n",
    ),
  type: z.enum(["single", "thread"]),
});

const scheduledPostSchema = z.object({
  postId: z.number(),
  content: z.string(),
  type: z.enum(["single", "thread"]),
  scheduledAt: z.string(),
  slot: z.string(),
  rationale: z.string(),
});

// ── Step 1: Research ─────────────────────────────────────────────────────────

const researchStep = createStep({
  id: "research",
  inputSchema: z.object({}),
  outputSchema: z.object({ brief: z.string() }),
  execute: async ({ mastra }) => {
    const agent = mastra!.getAgent("researcherAgent");
    const result = await agent.generate([
      {
        role: "user",
        content:
          "Research trending AI topics on X and the web from the last 24 hours. Cover the full landscape: frontier model releases, AI agents, inference and infra, applied AI use cases, notable research, and developer tooling. Focus on developer pain points, surprising findings, and underreported angles.",
      },
    ]);
    return { brief: result.text };
  },
});

// ── Step 2: Write ─────────────────────────────────────────────────────────────

const writeStep = createStep({
  id: "write",
  inputSchema: z.object({ brief: z.string() }),
  outputSchema: z.object({ posts: z.array(postSchema) }),
  execute: async ({ inputData, mastra }) => {
    const agent = mastra!.getAgent("writerAgent");
    const result = await agent.generate(
      [
        {
          role: "user",
          content: `Here are today's research findings. Turn the most interesting 4-6 angles into posts.\n\n${inputData.brief}`,
        },
      ],
      {
        structuredOutput: {
          schema: z.object({ posts: z.array(postSchema) }),
        },
      },
    );
    return { posts: result.object.posts };
  },
});

// ── Step 3: Schedule ──────────────────────────────────────────────────────────

const scheduleItemSchema = z.object({
  postId: z.number(),
  scheduledAt: z.string(),
  slot: z.string(),
  rationale: z.string(),
});

const scheduleStep = createStep({
  id: "schedule",
  inputSchema: z.object({ posts: z.array(postSchema) }),
  outputSchema: z.object({ scheduledPosts: z.array(scheduledPostSchema) }),
  execute: async ({ inputData, mastra }) => {
    const agent = mastra!.getAgent("schedulerAgent");
    const today = new Date().toISOString().split("T")[0];

    const postsFormatted = inputData.posts
      .map((p) => `Post ${p.id} [${p.type}]:\n${p.content}`)
      .join("\n\n");

    const result = await agent.generate(
      [
        {
          role: "user",
          content: `Today is ${today}. Here are ${inputData.posts.length} draft posts to schedule:\n\n${postsFormatted}`,
        },
      ],
      {
        structuredOutput: {
          schema: z.object({ scheduleItems: z.array(scheduleItemSchema) }),
        },
      },
    );

    const scheduledPosts: z.infer<typeof scheduledPostSchema>[] =
      result.object.scheduleItems.map((item) => {
        const post = inputData.posts.find((p) => p.id === item.postId);
        return {
          postId: item.postId,
          content: post?.content ?? "",
          type: post?.type ?? "single",
          scheduledAt: item.scheduledAt,
          slot: item.slot,
          rationale: item.rationale,
        };
      });

    return { scheduledPosts };
  },
});

// ── Workflow ──────────────────────────────────────────────────────────────────

export const dailyWorkflow = createWorkflow({
  id: "daily-workflow",
  inputSchema: z.object({}),
  outputSchema: z.object({ scheduledPosts: z.array(scheduledPostSchema) }),
})
  .then(researchStep)
  .then(writeStep)
  .then(scheduleStep);

dailyWorkflow.commit();

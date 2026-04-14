import { z } from 'zod';
import { runResearcher } from './agents/researcher-agent';
import { runWriter, postSchema } from './agents/writer-agent';
import { runScheduler, scheduleItemSchema } from './agents/scheduler-agent';

export const scheduledPostSchema = z.object({
  postId: z.number(),
  content: z.string(),
  type: z.enum(['single', 'thread']),
  scheduledAt: z.string(),
  slot: z.enum(['morning', 'lunch', 'afternoon', 'evening', 'night']),
  rationale: z.string(),
});

export type ScheduledPost = z.infer<typeof scheduledPostSchema>;

export async function runDailyWorkflow(): Promise<{ scheduledPosts: ScheduledPost[] }> {
  // Step 1: Research
  const brief = await runResearcher(
    'Research trending AI topics on X and the web from the last 24 hours. Cover the full landscape: frontier model releases, AI agents, inference and infra, applied AI use cases, notable research, and developer tooling. Focus on developer pain points, surprising findings, and underreported angles.',
  );

  // Step 2: Write
  const { posts } = await runWriter(
    `Here are today's research findings. Turn the most interesting 4-6 angles into posts.\n\n${brief}`,
  );

  // Step 3: Schedule
  const today = new Date().toISOString().split('T')[0];
  const postsFormatted = posts
    .map((p) => `Post ${p.id} [${p.type}]:\n${p.content}`)
    .join('\n\n');

  const scheduleItems = await runScheduler(
    `Today is ${today}. Here are ${posts.length} draft posts to schedule:\n\n${postsFormatted}`,
  );

  const scheduledPosts: ScheduledPost[] = scheduleItems.map((item) => {
    const post = posts.find((p) => p.id === item.postId);
    return {
      postId: item.postId,
      content: post?.content ?? '',
      type: post?.type ?? 'single',
      scheduledAt: item.scheduledAt,
      slot: item.slot,
      rationale: item.rationale,
    };
  });

  return { scheduledPosts };
}

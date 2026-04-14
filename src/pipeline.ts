import { runResearcher } from "./agents/researcher.js";
import { runWriter, type Post } from "./agents/writer.js";
import { runScheduler, type ScheduleItem } from "./agents/scheduler.js";

export type ScheduledPost = Post & ScheduleItem;

export async function runDailyWorkflow(): Promise<ScheduledPost[]> {
  const brief = await runResearcher(
    "Research trending AI topics on X and the web from the last 24 hours. Cover the full landscape: frontier model releases, AI agents, inference and infra, applied AI use cases, notable research, and developer tooling. Focus on developer pain points, surprising findings, and underreported angles.",
  );

  const posts = await runWriter(
    `Here are today's research findings. Turn the most interesting 4-6 angles into posts.\n\n${brief}`,
  );

  const today = new Date().toISOString().split("T")[0];
  const scheduleItems = await runScheduler(
    `Today is ${today}. Here are ${posts.length} draft posts to schedule:\n\n${posts
      .map((p) => `Post ${p.id} [${p.type}]:\n${p.content}`)
      .join("\n\n")}`,
  );

  return scheduleItems.map((item) => {
    const post = posts.find((p) => p.id === item.postId) ?? {
      content: "",
      type: "single" as const,
      id: item.postId,
    };
    return { ...post, ...item };
  });
}

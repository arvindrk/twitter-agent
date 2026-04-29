import { runResearcher } from "./agents/researcher.js";
import { runWriter, type Post } from "./agents/writer.js";
import { runScheduler, type ScheduleItem } from "./agents/scheduler.js";

type ScheduledPost = Post & ScheduleItem;

export async function runDailyWorkflow(): Promise<ScheduledPost[]> {
  const lap = () => {
    const start = Date.now();
    return () => `${((Date.now() - start) / 1000).toFixed(1)}s`;
  };

  let elapsed = lap();
  console.log("[pipeline] researcher starting");
  const brief = await runResearcher(
    "Research trending AI topics on X and the web from the last 24 hours. Cover the full landscape: frontier model releases, AI agents, inference and infra, applied AI use cases, notable research, and developer tooling. Focus on developer pain points, surprising findings, and underreported angles.",
  );
  console.log(`[pipeline] researcher done in ${elapsed()} — ${brief.length} chars`);

  elapsed = lap();
  console.log("[pipeline] writer starting");
  const posts = await runWriter(
    `Here are today's research findings. Turn the most interesting 4-6 angles into posts.\n\n${brief}`,
  );
  console.log(`[pipeline] writer done in ${elapsed()} — ${posts.length} posts`);

  elapsed = lap();
  const today = new Date().toISOString().split("T")[0];
  console.log("[pipeline] scheduler starting");
  const scheduleItems = await runScheduler(
    `Today is ${today}. Here are ${posts.length} draft posts to schedule:\n\n${posts
      .map((p) => `Post ${p.id} [${p.type}]:\n${p.content}`)
      .join("\n\n")}`,
  );
  console.log(`[pipeline] scheduler done in ${elapsed()} — ${scheduleItems.length} items`);

  return scheduleItems.flatMap((item) => {
    const post = posts.find((p) => p.id === item.postId);
    return post ? [{ ...post, ...item }] : [];
  });
}

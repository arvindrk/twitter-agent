import { generateObject } from "ai";
import { xai } from "@ai-sdk/xai";
import { z } from "zod";

const SYSTEM = `
You are a scheduling assistant for a Twitter account in the AI / developer tools space.

Given a list of draft posts for today, assign each one an optimal posting time.

## Audience

Developers, AI builders, founders — primarily US-based (EST/PST), with a secondary audience in Europe. Most active on X during:
- 8–10 AM EST (morning check)
- 12–2 PM EST (lunch)
- 5–7 PM EST (end of workday)
- 9–11 PM EST (evening scroll)

## Scheduling rules

1. Spread posts across the day — minimum 90 minutes between posts
2. Prefer the high-engagement windows above
3. Start no earlier than 7 AM EST, end no later than 10 PM EST
4. If there's a thread, schedule it as a single unit (one time slot)
5. Put the most compelling / broadest-appeal post in the best slot (usually 8–9 AM or 12–1 PM EST)
6. Save more niche / technical posts for off-peak times
`.trim();

const scheduleItemSchema = z.object({
  postId: z.number(),
  scheduledAt: z.string(),
  slot: z.enum(["morning", "lunch", "afternoon", "evening", "night"]),
  rationale: z.string(),
});

export type ScheduleItem = z.infer<typeof scheduleItemSchema>;

export async function runScheduler(
  userMessage: string,
): Promise<ScheduleItem[]> {
  const { object, usage } = await generateObject({
    model: xai("grok-4-1-fast-non-reasoning"),
    system: SYSTEM,
    messages: [{ role: "user", content: userMessage }],
    schema: z.object({ scheduleItems: z.array(scheduleItemSchema) }),
  });
  console.log(`[scheduler] usage — in:${usage.inputTokens} out:${usage.outputTokens}`);
  object.scheduleItems.forEach((s) =>
    console.log(`[scheduler] post ${s.postId} → ${s.slot} @ ${s.scheduledAt}`),
  );
  return object.scheduleItems;
}

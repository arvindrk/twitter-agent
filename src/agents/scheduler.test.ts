import { describe, it, expect, mock, beforeAll } from "bun:test";

mock.module("ai", () => ({
  generateObject: mock(async () => ({
    object: {
      scheduleItems: [
        {
          postId: 1,
          scheduledAt: "2026-04-29T13:00:00.000Z",
          slot: "morning",
          rationale: "Peak engagement",
        },
        {
          postId: 2,
          scheduledAt: "2026-04-29T17:00:00.000Z",
          slot: "afternoon",
          rationale: "Secondary window",
        },
      ],
    },
    usage: { inputTokens: 5, outputTokens: 15 },
  })),
}));
mock.module("@ai-sdk/xai", () => ({ xai: () => ({}) }));

let runScheduler: (msg: string) => Promise<unknown[]>;

beforeAll(async () => {
  ({ runScheduler } = await import("./scheduler.js"));
});

describe("runScheduler", () => {
  it("returns typed ScheduleItem[] from model output", async () => {
    const items = await runScheduler("schedule these posts") as Array<{
      postId: number;
      scheduledAt: string;
      slot: string;
      rationale: string;
    }>;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ postId: 1, slot: "morning" });
    expect(items[1]).toMatchObject({ postId: 2, slot: "afternoon" });
  });

  it("all required fields are present on each item", async () => {
    const items = await runScheduler("brief") as Array<Record<string, unknown>>;
    for (const item of items) {
      expect(typeof item.postId).toBe("number");
      expect(typeof item.scheduledAt).toBe("string");
      expect(typeof item.slot).toBe("string");
      expect(typeof item.rationale).toBe("string");
    }
  });
});

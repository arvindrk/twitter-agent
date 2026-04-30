import { describe, it, expect, mock, beforeAll } from "bun:test";
import { makePost, makeScheduleItem } from "./test/helpers.js";

mock.module("./agents/researcher.js", () => ({
  runResearcher: mock(async () => "mock brief"),
}));

mock.module("./agents/writer.js", () => ({
  runWriter: mock(async () => [makePost({ id: 1 }), makePost({ id: 2 })]),
}));

mock.module("./agents/scheduler.js", () => ({
  runScheduler: mock(async () => [
    makeScheduleItem({ postId: 1 }),
    makeScheduleItem({ postId: 2 }),
  ]),
}));

let runDailyWorkflow: () => Promise<unknown[]>;

beforeAll(async () => {
  ({ runDailyWorkflow } = await import("./pipeline.js"));
});

describe("pipeline — merge logic", () => {
  it("merges posts and scheduleItems with matching ids", async () => {
    const result = await runDailyWorkflow();
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 1, postId: 1, slot: "morning" });
    expect(result[1]).toMatchObject({ id: 2, postId: 2, slot: "morning" });
  });

  it("drops scheduleItem when no matching post exists", async () => {
    const { runWriter, runScheduler } = await import("./agents/writer.js") as any;
    runWriter.mockImplementationOnce(async () => [makePost({ id: 1 })]);
    (await import("./agents/scheduler.js") as any).runScheduler.mockImplementationOnce(
      async () => [makeScheduleItem({ postId: 1 }), makeScheduleItem({ postId: 99 })],
    );
    const result = await runDailyWorkflow();
    expect(result).toHaveLength(1);
    expect((result[0] as any).postId).toBe(1);
  });

  it("drops post when no matching scheduleItem exists", async () => {
    const { runWriter, runScheduler } = await import("./agents/writer.js") as any;
    runWriter.mockImplementationOnce(async () => [
      makePost({ id: 1 }),
      makePost({ id: 2 }),
    ]);
    (await import("./agents/scheduler.js") as any).runScheduler.mockImplementationOnce(
      async () => [makeScheduleItem({ postId: 1 })],
    );
    const result = await runDailyWorkflow();
    expect(result).toHaveLength(1);
  });

  it("returns empty array when inputs are empty", async () => {
    (await import("./agents/writer.js") as any).runWriter.mockImplementationOnce(async () => []);
    (await import("./agents/scheduler.js") as any).runScheduler.mockImplementationOnce(async () => []);
    const result = await runDailyWorkflow();
    expect(result).toHaveLength(0);
  });
});

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  type HonoBindings,
  type HonoVariables,
  MastraServer,
} from "@mastra/hono";
import { mastra } from "./mastra/index.js";
import { publishTweet } from "./x/poster.js";

const app = new Hono<{ Bindings: HonoBindings; Variables: HonoVariables }>();
const server = new MastraServer({ app, mastra });

await server.init();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.post("/test/post", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const text: string = body.text ?? `test post from x-agent — ${new Date().toISOString()}`;

  try {
    const result = await publishTweet(text);
    return c.json({ ok: true, tweet: result });
  } catch (err: any) {
    console.error("[/test/post]", err);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/run/daily", async (c) => {
  const workflow = mastra.getWorkflow("dailyWorkflow");
  const run = await workflow.createRun();

  // Blocks until the full pipeline completes (research → write → schedule).
  // This can take 30-90s. For production use startAsync() and poll /run/:id.
  const result = await run.start({ inputData: {} });

  if (result.status === "success") {
    const { scheduledPosts } = result.result;
    return c.json({ ok: true, scheduledPosts });
  }

  const error = result.status === "failed" ? result.error : undefined;
  console.error("Workflow failed:", result.status, error);
  return c.json(
    { ok: false, status: result.status, error: error?.message, stack: error?.stack, steps: result.steps },
    500
  );
});

serve(
  {
    fetch: app.fetch,
    port: 3010,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);

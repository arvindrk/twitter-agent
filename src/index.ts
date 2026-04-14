import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { publishTweet } from "./x/poster.js";
import { automation } from "./routes/automation.js";

const app = new Hono();

app.route("/cron", automation);

app.get("/", (c) => c.json({ ok: true }));

app.post("/test/post", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const text: string =
    body.text ?? `test post from x-agent — ${new Date().toISOString()}`;

  try {
    const result = await publishTweet(text);
    return c.json({ ok: true, tweet: result });
  } catch (err: any) {
    console.error("[/test/post]", err);
    return c.json({ ok: false, error: err.message }, 500);
  }
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

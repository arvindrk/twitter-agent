import { Hono } from "hono";
import cron from "./routes/cron.js";
import webhooks from "./routes/webhooks.js";

const app = new Hono();

app.get("/", (c) => c.json({ ok: true }));
app.route("/cron", cron);
app.route("/webhooks", webhooks);

export default app;

import { serve } from "@hono/node-server";
import app from "./app.js";

serve({ fetch: app.fetch, port: 3010 }, (info) =>
  console.log(`Server is running on http://localhost:${info.port}`),
);

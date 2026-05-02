import { serve } from "@hono/node-server";
import { initLogger } from "./logger.js";
import app from "./app.js";

initLogger();

serve({ fetch: app.fetch, port: 3010 }, (info) =>
	console.log(`Server is running on http://localhost:${info.port}`),
);

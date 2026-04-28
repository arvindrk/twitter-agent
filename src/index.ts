import { serve } from "@hono/node-server";
import app from "./app.js";

const ts = () => new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour12: true });
const origLog = console.log.bind(console);
const origError = console.error.bind(console);
console.log = (...args) => origLog(ts(), ...args);
console.error = (...args) => origError(ts(), ...args);

serve({ fetch: app.fetch, port: 3010 }, (info) =>
  console.log(`Server is running on http://localhost:${info.port}`),
);

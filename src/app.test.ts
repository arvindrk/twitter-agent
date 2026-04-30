import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { stubEnv, stubDbModule, stubXModule, makePost, makeScheduleItem } from "./test/helpers.js";

mock.module("./db.js", () => ({ ...stubDbModule }));
mock.module("./x.js", () => ({ ...stubXModule }));
mock.module("./pipeline.js", () => ({
  runDailyWorkflow: mock(async () => []),
}));

let app: import("hono").Hono;
let restore: () => void;

beforeAll(async () => {
  restore = stubEnv({ CRON_SECRET: "test-secret" });
  ({ default: app } = await import("./app.js"));
});

afterAll(() => restore());

const authed = { headers: { "x-cron-secret": "test-secret" } };
const cronUrl = (path: string) => `http://localhost${path}`;

describe("isAuthorized — middleware", () => {
  it("allows requests when CRON_SECRET env is not set", async () => {
    delete process.env.CRON_SECRET;
    const res = await app.request(cronUrl("/"), { method: "GET" });
    expect(res.status).toBe(200);
    process.env.CRON_SECRET = "test-secret";
  });

  it("allows requests with correct secret in x-cron-secret header", async () => {
    const res = await app.request(cronUrl("/cron/daily"), { method: "GET", ...authed });
    expect(res.status).toBe(202);
  });

  it("allows requests with correct secret as query param", async () => {
    const res = await app.request(cronUrl("/cron/daily?secret=test-secret"), { method: "GET" });
    expect(res.status).toBe(202);
  });

  it("rejects requests with wrong secret", async () => {
    const res = await app.request(cronUrl("/cron/daily"), {
      method: "GET",
      headers: { "x-cron-secret": "wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests with missing secret when CRON_SECRET is set", async () => {
    const res = await app.request(cronUrl("/cron/daily"), { method: "GET" });
    expect(res.status).toBe(401);
  });
});

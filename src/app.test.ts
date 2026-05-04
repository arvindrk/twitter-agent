import {
	describe,
	it,
	expect,
	mock,
	beforeAll,
	afterAll,
	beforeEach,
} from "bun:test";
import { stubEnv } from "./test/helpers.js";
import { createHmac } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pipeline: Record<string, any> = {
	runDailyWorkflowAndPersist: async () => ({ count: 0, ids: [] }),
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const publisher: Record<string, any> = {
	publishDuePosts: async () => ({ processed: 0, skipped: 0, failed: [] }),
	publishSinglePost: async () => ({
		ok: true,
		status: "published",
		tweetId: "tweet-123",
		tweetUrl: "https://x.com/i/web/status/tweet-123",
	}),
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const engagement: Record<string, any> = {
	processEngagementEvent: async () => {},
};

// Wrapper functions so named imports in routes always delegate to current values.
mock.module("./services/pipeline.js", () => ({
	runDailyWorkflowAndPersist: (...a: unknown[]) =>
		pipeline.runDailyWorkflowAndPersist(...a),
}));
mock.module("./services/publisher.js", () => ({
	publishDuePosts: (...a: unknown[]) => publisher.publishDuePosts(...a),
	publishSinglePost: (...a: unknown[]) => publisher.publishSinglePost(...a),
}));
mock.module("./services/engagement.js", () => ({
	processEngagementEvent: (...a: unknown[]) =>
		engagement.processEngagementEvent(...a),
}));

let app: import("hono").Hono;
let restore: () => void;

beforeAll(async () => {
	restore = stubEnv({ CRON_SECRET: "test-secret" });
	({ default: app } = await import("./app.js"));
});

beforeEach(() => {
	pipeline.runDailyWorkflowAndPersist = async () => ({ count: 0, ids: [] });
	publisher.publishDuePosts = async () => ({
		processed: 0,
		skipped: 0,
		failed: [],
	});
	publisher.publishSinglePost = async () => ({
		ok: true,
		status: "published",
		tweetId: "tweet-123",
		tweetUrl: "https://x.com/i/web/status/tweet-123",
	});
	engagement.processEngagementEvent = async () => {};
});

afterAll(() => restore());

const authed = { headers: { "x-cron-secret": "test-secret" } };
const cronUrl = (path: string) => `http://localhost${path}`;

describe("isAuthorized — middleware", () => {
	it("rejects cron requests when CRON_SECRET env is not set (fail-closed)", async () => {
		delete process.env.CRON_SECRET;
		const res = await app.request(cronUrl("/cron/daily"), {
			method: "GET",
		});
		expect(res.status).toBe(401);
		process.env.CRON_SECRET = "test-secret";
	});

	it("allows requests with correct secret in x-cron-secret header", async () => {
		const res = await app.request(cronUrl("/cron/daily"), {
			method: "GET",
			...authed,
		});
		expect(res.status).toBe(202);
	});

	it("rejects requests with secret in query param (header-only)", async () => {
		const res = await app.request(
			cronUrl("/cron/daily?secret=test-secret"),
			{
				method: "GET",
			},
		);
		expect(res.status).toBe(401);
	});

	it("rejects requests with wrong secret", async () => {
		const res = await app.request(cronUrl("/cron/daily"), {
			method: "GET",
			headers: { "x-cron-secret": "wrong" },
		});
		expect(res.status).toBe(401);
	});

	it("rejects requests with wrong-length secret (constant-time guard)", async () => {
		const res = await app.request(cronUrl("/cron/daily"), {
			method: "GET",
			headers: { "x-cron-secret": "test-secret-but-longer" },
		});
		expect(res.status).toBe(401);
	});

	it("rejects requests with missing secret when CRON_SECRET is set", async () => {
		const res = await app.request(cronUrl("/cron/daily"), {
			method: "GET",
		});
		expect(res.status).toBe(401);
	});
});

describe("GET /", () => {
	it("returns 200 with ok: true", async () => {
		const res = await app.request(cronUrl("/"), { method: "GET" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});
});

describe("GET /cron/daily", () => {
	it("returns 202 with runId and fires pipeline async", async () => {
		const res = await app.request(cronUrl("/cron/daily"), {
			method: "GET",
			...authed,
		});
		expect(res.status).toBe(202);
		const body = (await res.json()) as { ok: boolean; runId: string };
		expect(body.ok).toBe(true);
		expect(typeof body.runId).toBe("string");
		expect(body.runId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});
});

describe("POST /cron/execute-post — scan mode", () => {
	const post = (body?: object) =>
		app.request(cronUrl("/cron/execute-post"), {
			method: "POST",
			...authed,
			headers: { ...authed.headers, "content-type": "application/json" },
			body: body ? JSON.stringify(body) : undefined,
		});

	it("returns 401 when unauthorized", async () => {
		const res = await app.request(cronUrl("/cron/execute-post"), {
			method: "POST",
		});
		expect(res.status).toBe(401);
	});

	it("calls publishDuePosts and returns result", async () => {
		publisher.publishDuePosts = mock(async () => ({
			processed: 1,
			skipped: 0,
			failed: [],
		}));
		const res = await post();
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; processed: number };
		expect(body.ok).toBe(true);
		expect(body.processed).toBe(1);
	});
});

describe("POST /cron/execute-post — single-post mode", () => {
	const singlePost = (postId: number) =>
		app.request(cronUrl("/cron/execute-post"), {
			method: "POST",
			...authed,
			headers: { ...authed.headers, "content-type": "application/json" },
			body: JSON.stringify({ postId }),
		});

	it("returns published post data on success", async () => {
		publisher.publishSinglePost = mock(async () => ({
			ok: true,
			status: "published",
			tweetId: "tweet-456",
			tweetUrl: "https://x.com/i/web/status/tweet-456",
		}));
		const res = await singlePost(10);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ok: boolean;
			tweetId: string;
			tweetUrl: string;
		};
		expect(body.ok).toBe(true);
		expect(body.tweetId).toBe("tweet-456");
		expect(body.tweetUrl).toBe("https://x.com/i/web/status/tweet-456");
	});

	it("returns 200 with skipped status when post already claimed", async () => {
		publisher.publishSinglePost = mock(async () => ({
			ok: true,
			status: "skipped",
		}));
		const res = await singlePost(10);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; status: string };
		expect(body.ok).toBe(true);
		expect(body.status).toBe("skipped");
	});

	it("returns 501 for thread type", async () => {
		publisher.publishSinglePost = mock(async () => ({
			ok: false,
			error: "Thread publishing not yet implemented",
			httpStatus: 501,
		}));
		const res = await singlePost(10);
		expect(res.status).toBe(501);
	});

	it("returns 500 when publish fails", async () => {
		publisher.publishSinglePost = mock(async () => ({
			ok: false,
			error: "rate limited",
			httpStatus: 500,
		}));
		const res = await singlePost(10);
		expect(res.status).toBe(500);
		const body = (await res.json()) as { ok: boolean; error: string };
		expect(body.ok).toBe(false);
		expect(body.error).toBe("rate limited");
	});
});

const WEBHOOK_SECRET = "test-api-secret";
const MY_USER_ID = "me-42";

function webhookSig(body: string) {
	return (
		"sha256=" +
		createHmac("sha256", WEBHOOK_SECRET).update(body).digest("base64")
	);
}

function mentionPayload(tweetId = "tw-1", authorId = "user-99") {
	return JSON.stringify({
		for_user_id: MY_USER_ID,
		tweet_create_events: [
			{
				id_str: tweetId,
				text: "@me how does your agent handle rate limits?",
				user: { id_str: authorId, screen_name: "devuser" },
				in_reply_to_status_id_str: null,
				in_reply_to_user_id_str: MY_USER_ID,
				is_quote_status: false,
				entities: {
					user_mentions: [{ id_str: MY_USER_ID, screen_name: "me" }],
				},
			},
		],
	});
}

describe("GET /webhooks/x", () => {
	const VALID_CRC = "MmNiOWE0ZTktNDIzZS00ZjAyLTk5OWY";

	it("returns sha256 CRC response for valid crc_token", async () => {
		const restore = stubEnv({ X_API_SECRET: WEBHOOK_SECRET });
		const res = await app.request(
			`http://localhost/webhooks/x?crc_token=${VALID_CRC}`,
		);
		restore();
		expect(res.status).toBe(200);
		const body = (await res.json()) as { response_token: string };
		expect(body.response_token).toMatch(/^sha256=/);
		const expectedToken =
			"sha256=" +
			createHmac("sha256", WEBHOOK_SECRET)
				.update(VALID_CRC)
				.digest("base64");
		expect(body.response_token).toBe(expectedToken);
	});

	it("returns 400 when crc_token is missing", async () => {
		const res = await app.request("http://localhost/webhooks/x");
		expect(res.status).toBe(400);
	});

	it("rejects crc_token containing JSON characters (oracle defense)", async () => {
		const restore = stubEnv({ X_API_SECRET: WEBHOOK_SECRET });
		const forgedBody = mentionPayload();
		const res = await app.request(
			`http://localhost/webhooks/x?crc_token=${encodeURIComponent(forgedBody)}`,
		);
		restore();
		expect(res.status).toBe(400);
	});

	it("rejects crc_token shorter than 8 chars", async () => {
		const restore = stubEnv({ X_API_SECRET: WEBHOOK_SECRET });
		const res = await app.request(
			"http://localhost/webhooks/x?crc_token=short",
		);
		restore();
		expect(res.status).toBe(400);
	});
});

describe("POST /webhooks/x", () => {
	it("returns 401 with invalid signature", async () => {
		const restore = stubEnv({ X_API_SECRET: WEBHOOK_SECRET });
		const body = mentionPayload();
		const res = await app.request("http://localhost/webhooks/x", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-twitter-webhooks-signature": "sha256=bad",
			},
			body,
		});
		restore();
		expect(res.status).toBe(401);
	});

	it("returns 200 with valid signature", async () => {
		const restore = stubEnv({
			X_API_SECRET: WEBHOOK_SECRET,
			X_USER_ID: MY_USER_ID,
		});
		const body = mentionPayload();
		const res = await app.request("http://localhost/webhooks/x", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-twitter-webhooks-signature": webhookSig(body),
			},
			body,
		});
		restore();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it("returns 200 and is a no-op for payloads with no tweet_create_events", async () => {
		const restore = stubEnv({
			X_API_SECRET: WEBHOOK_SECRET,
			X_USER_ID: MY_USER_ID,
		});
		const body = JSON.stringify({ for_user_id: MY_USER_ID });
		const res = await app.request("http://localhost/webhooks/x", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-twitter-webhooks-signature": webhookSig(body),
			},
			body,
		});
		restore();
		expect(res.status).toBe(200);
	});
});

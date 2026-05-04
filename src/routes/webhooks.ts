import { Hono } from "hono";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature } from "../middleware/auth.js";
import {
	processEngagementEvent,
	type XWebhookPayload,
} from "../services/engagement.js";

const webhooks = new Hono();

// Restricts the CRC oracle to alphanumeric/base64-shaped inputs only, so it
// cannot be coerced into signing a JSON webhook body (which requires {}":,).
const CRC_TOKEN_PATTERN = /^[A-Za-z0-9_=\-+/]{8,512}$/;

webhooks.get("/x", (c) => {
	const crcToken = c.req.query("crc_token");
	if (!crcToken) return c.json({ error: "missing crc_token" }, 400);
	if (!CRC_TOKEN_PATTERN.test(crcToken))
		return c.json({ error: "invalid crc_token" }, 400);
	const secret = process.env.X_API_SECRET;
	if (!secret) return c.json({ error: "server misconfigured" }, 500);
	const hash = createHmac("sha256", secret).update(crcToken).digest("base64");
	return c.json({ response_token: `sha256=${hash}` });
});

webhooks.post("/x", async (c) => {
	const rawBody = await c.req.text();
	const signature = c.req.header("x-twitter-webhooks-signature");

	if (!verifyWebhookSignature(rawBody, signature))
		return c.json({ error: "Invalid signature" }, 401);

	let payload: XWebhookPayload;
	try {
		payload = JSON.parse(rawBody) as XWebhookPayload;
	} catch {
		return c.json({ error: "Invalid JSON" }, 400);
	}

	processEngagementEvent(payload).catch((err: unknown) => {
		console.error(
			"[webhooks/x] unhandled error:",
			err instanceof Error ? err.message : err,
		);
	});

	return c.json({ ok: true });
});

export default webhooks;

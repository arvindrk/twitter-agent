import { createHmac, timingSafeEqual } from "node:crypto";

function constantTimeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	if (ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

export function isAuthorized(req: Request): boolean {
	const secret = process.env.CRON_SECRET;
	if (!secret) return false;
	const token = req.headers.get("x-cron-secret");
	if (!token) return false;
	return constantTimeEqual(token, secret);
}

export function verifyWebhookSignature(
	rawBody: string,
	signature: string | undefined,
): boolean {
	if (!signature) return false;
	const secret = process.env.X_API_SECRET;
	if (!secret) return false;
	const expected =
		"sha256=" +
		createHmac("sha256", secret).update(rawBody).digest("base64");
	return constantTimeEqual(expected, signature);
}

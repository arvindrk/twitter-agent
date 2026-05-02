import { createHmac, timingSafeEqual } from "node:crypto";

export function isAuthorized(req: Request): boolean {
	const secret = process.env.CRON_SECRET;
	if (!secret) return true;
	const token =
		req.headers.get("x-cron-secret") ??
		new URL(req.url).searchParams.get("secret");
	return token === secret;
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
	try {
		return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
	} catch {
		return false;
	}
}

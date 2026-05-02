import { createHmac, randomBytes } from "node:crypto";

const WEBHOOK_ID = "2050473080393486337";
const SUBSCRIBE_URL = `https://api.twitter.com/2/account_activity/webhooks/${WEBHOOK_ID}/subscriptions/all`;

function env(k: string): string {
	const v = process.env[k];
	if (!v) throw new Error(`Missing env var: ${k}`);
	return v;
}

function oauthSign(
	method: string,
	url: string,
	params: Record<string, string>,
	consumerSecret: string,
	tokenSecret: string,
): string {
	const sorted = Object.entries(params)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${encode(k)}=${encode(v)}`)
		.join("&");

	const base = [method.toUpperCase(), encode(url), encode(sorted)].join("&");
	const key = `${encode(consumerSecret)}&${encode(tokenSecret)}`;
	return createHmac("sha1", key).update(base).digest("base64");
}

function encode(s: string): string {
	return encodeURIComponent(s).replace(
		/[!'()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

function authHeader(params: Record<string, string>): string {
	return (
		"OAuth " +
		Object.entries(params)
			.map(([k, v]) => `${encode(k)}="${encode(v)}"`)
			.join(", ")
	);
}

const apiKey = env("X_API_KEY");
const apiSecret = env("X_API_SECRET");
const accessToken = env("X_ACCESS_TOKEN");
const accessTokenSecret = env("X_ACCESS_TOKEN_SECRET");

const oauthParams: Record<string, string> = {
	oauth_consumer_key: apiKey,
	oauth_nonce: randomBytes(16).toString("hex"),
	oauth_signature_method: "HMAC-SHA1",
	oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
	oauth_token: accessToken,
	oauth_version: "1.0",
};
oauthParams.oauth_signature = oauthSign(
	"POST",
	SUBSCRIBE_URL,
	oauthParams,
	apiSecret,
	accessTokenSecret,
);

const res = await fetch(SUBSCRIBE_URL, {
	method: "POST",
	headers: { Authorization: authHeader(oauthParams) },
});

console.log(`Status: ${res.status}`);
if (res.status === 204) {
	console.log("Subscribed successfully. Webhook will now receive events.");
} else {
	console.error("Failed:", await res.text());
}

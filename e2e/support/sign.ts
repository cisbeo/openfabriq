import { createHmac } from "node:crypto";

const now = () => Math.floor(Date.now() / 1000);

/** The headers of a Standard Webhooks delivery, signed with a `whsec_` secret. */
export function standardWebhook(
	secret: string,
	id: string,
	body: string,
	at = now(),
): Record<string, string> {
	const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
	const signature = createHmac("sha256", key)
		.update(`${id}.${at}.${body}`)
		.digest("base64");
	return {
		"content-type": "application/json",
		"webhook-id": id,
		"webhook-timestamp": String(at),
		"webhook-signature": `v1,${signature}`,
	};
}

/** The headers of a Slack Events API request, signed with the app's signing secret. */
export function slackRequest(
	secret: string,
	body: string,
	at = now(),
): Record<string, string> {
	const signature = createHmac("sha256", secret)
		.update(`v0:${at}:${body}`)
		.digest("hex");
	return {
		"content-type": "application/json",
		"X-Slack-Signature": `v0=${signature}`,
		"X-Slack-Request-Timestamp": String(at),
	};
}

/** The headers of a Linear webhook: the hex HMAC-SHA256 of the body, with the webhook signing secret. */
export function linearRequest(
	secret: string,
	delivery: string,
	body: string,
): Record<string, string> {
	return {
		"content-type": "application/json",
		"Linear-Delivery": delivery,
		"Linear-Signature": createHmac("sha256", secret).update(body).digest("hex"),
	};
}

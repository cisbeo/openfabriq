// Slack's Events API over HTTP. Checked on docs.slack.dev on 2026-11-03:
// "Verifying requests from Slack" and the url_verification event.

import { concatBytes, hexToBytes, hmacMatches } from "../../shared/crypto";

const encoder = new TextEncoder();

/**
 * X-Slack-Signature is `v0=` and the hex HMAC-SHA256, keyed with the signing secret, of
 * `v0:<X-Slack-Request-Timestamp>:<raw body>`.
 */
export async function verifySignature(
	body: ArrayBuffer,
	signature: string | null,
	timestamp: string | null,
	secret: string,
): Promise<boolean> {
	const hex = /^v0=([0-9a-f]{64})$/i.exec(signature ?? "")?.[1];
	if (!hex || !timestamp) return false;
	return hmacMatches(
		encoder.encode(secret),
		concatBytes(encoder.encode(`v0:${timestamp}:`), body),
		hexToBytes(hex),
	);
}

// What the integrations check a request with: HMAC-SHA256 signatures and secrets, compared in
// constant time, and how recent a signed timestamp is.

const encoder = new TextEncoder();

/** Slack's, Stripe's and Standard Webhooks' advice: refuse a timestamp more than five minutes away. */
const FRESHNESS_SECONDS = 5 * 60;

export const concatBytes = (...parts: (Uint8Array | ArrayBuffer)[]) => {
	const bytes = parts.map((p) => new Uint8Array(p));
	const out = new Uint8Array(bytes.reduce((n, b) => n + b.byteLength, 0));
	let at = 0;
	for (const b of bytes) {
		out.set(b, at);
		at += b.byteLength;
	}
	return out;
};

export const hexToBytes = (hex: string) =>
	Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

/** crypto.subtle.verify compares in constant time. */
export async function hmacMatches(
	key: Uint8Array,
	signed: Uint8Array | ArrayBuffer,
	expected: Uint8Array,
): Promise<boolean> {
	const imported = await crypto.subtle.importKey(
		"raw",
		key,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	return crypto.subtle.verify("HMAC", imported, expected, signed);
}

/** Whether a timestamp in epoch seconds is within five minutes of now. */
export function isRecentTimestamp(
	timestamp: string | null,
	now = Date.now(),
): boolean {
	if (!timestamp || !/^\d+$/.test(timestamp)) return false;
	return Math.abs(now / 1000 - Number(timestamp)) <= FRESHNESS_SECONDS;
}

/** Whether two secrets are equal, compared in constant time. */
export function sameSecret(given: string, expected: string): boolean {
	const a = encoder.encode(given);
	const b = encoder.encode(expected);
	// Compare even on a length mismatch, so the timing does not reveal the length.
	return a.byteLength === b.byteLength
		? crypto.subtle.timingSafeEqual(a, b)
		: !crypto.subtle.timingSafeEqual(a, a);
}

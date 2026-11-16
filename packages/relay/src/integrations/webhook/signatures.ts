// The factory's own webhooks: a closed list of ways a sender proves it is itself.
// Each check follows its sender's documentation; the comment beside it says what that page asks.

import {
	concatBytes,
	hexToBytes,
	hmacMatches,
	isRecentTimestamp,
	sameSecret,
} from "../../shared/crypto";
import { parseJsonBody } from "../../shared/http";

export const SIGNATURES = [
	"github",
	"sentry",
	"stripe",
	"standard",
	"none",
] as const;
export type Signature = (typeof SIGNATURES)[number];

/** Signatures tried at most in one header: a sender rotating its secrets sends two or three. */
const MAX_CANDIDATES = 5;
const encoder = new TextEncoder();

const fromBase64 = (text: string): Uint8Array | null => {
	try {
		return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
	} catch {
		return null;
	}
};

/** A standard secret's key: the base64 after "whsec_"; null when it is not base64, or empty. */
export function standardWebhookKey(secret: string): Uint8Array | null {
	const key = fromBase64(secret.replace(/^whsec_/, ""));
	return key?.length ? key : null;
}

/** One HMAC per candidate, stopped at the first match; a header with too many is refused. */
async function anyMatches(
	key: Uint8Array,
	signed: Uint8Array,
	candidates: Uint8Array[],
): Promise<boolean> {
	if (candidates.length > MAX_CANDIDATES) return false;
	for (const candidate of candidates)
		if (await hmacMatches(key, signed, candidate)) return true;
	return false;
}

type Check = { ok: true; delivery?: string } | { ok: false; status: 400 | 401 };

const REFUSED: Check = { ok: false, status: 401 };

/** What a check reads of the request and of the webhook's configuration. */
interface SignedRequest {
	secret: string;
	body: ArrayBuffer;
	header: (name: string) => string | null;
	pathSecret: string | undefined;
	now: number;
}

const CHECKS: Record<Signature, (request: SignedRequest) => Promise<Check>> = {
	// X-Hub-Signature-256: sha256= and the hex HMAC-SHA256 of the raw body. X-GitHub-Delivery is
	// not signed, and there is no timestamp: a captured body sent again with a new id would be a
	// new event. Without `delivery`, the body hash is the delivery.
	github: checkHexBody("X-Hub-Signature-256", /^sha256=([0-9a-f]{64})$/i),
	// Sentry-Hook-Signature: the hex HMAC-SHA256 of the body, keyed with the client secret.
	// Request-ID is not signed either: the body hash is the delivery, as for GitHub.
	sentry: checkHexBody("Sentry-Hook-Signature", /^([0-9a-f]{64})$/i),
	stripe: checkStripe,
	standard: checkStandard,
	none: checkPathSecret,
};

/**
 * Whether a request comes from the webhook's sender. `delivery` is the sender's id for this
 * delivery, when it signs one: the relay keeps an event once per delivery.
 */
export async function checkWebhook(
	signature: Signature,
	secret: string,
	body: ArrayBuffer,
	header: (name: string) => string | null,
	pathSecret: string | undefined,
	now = Date.now(),
): Promise<Check> {
	return CHECKS[signature]({ secret, body, header, pathSecret, now });
}

/** A header holding the hex HMAC-SHA256 of the raw body, captured by `pattern`. */
function checkHexBody(name: string, pattern: RegExp) {
	return async ({ secret, body, header }: SignedRequest): Promise<Check> => {
		const hex = pattern.exec(header(name) ?? "")?.[1];
		return hex &&
			(await hmacMatches(encoder.encode(secret), body, hexToBytes(hex)))
			? { ok: true }
			: REFUSED;
	};
}

/** Signed: "<t>." and the raw body. */
async function checkStripe({
	secret,
	body,
	header,
	now,
}: SignedRequest): Promise<Check> {
	const { t, candidates } = stripeHeader(header("Stripe-Signature") ?? "");
	if (!t || !candidates.length) return REFUSED;
	const signed = concatBytes(encoder.encode(`${t}.`), body);
	if (!(await anyMatches(encoder.encode(secret), signed, candidates)))
		return REFUSED;
	if (!isRecentTimestamp(t, now)) return { ok: false, status: 400 };
	const id = eventId(body);
	return { ok: true, ...(id ? { delivery: id } : {}) };
}

/** Stripe-Signature: t=<seconds>,v1=<hex>[,v1=…]; a v1= that is not 64 hex digits is skipped. */
function stripeHeader(value: string): {
	t: string | null;
	candidates: Uint8Array[];
} {
	const parts = value
		.split(",")
		.map((p) => p.split("=", 2) as [string, string | undefined]);
	return {
		t: parts.find(([k]) => k === "t")?.[1] ?? null,
		candidates: parts
			.filter(([k, v]) => k === "v1" && v && /^[0-9a-f]{64}$/i.test(v))
			.map(([, v]) => hexToBytes(v ?? "")),
	};
}

/** Signed: "<id>.<timestamp>." and the raw body; the secret is base64 after "whsec_". */
async function checkStandard({
	secret,
	body,
	header,
	now,
}: SignedRequest): Promise<Check> {
	const id = header("webhook-id");
	const timestamp = header("webhook-timestamp");
	const secretBytes = standardWebhookKey(secret);
	if (!id || !timestamp || !secretBytes) return REFUSED;
	const signed = concatBytes(encoder.encode(`${id}.${timestamp}.`), body);
	const candidates = standardCandidates(header("webhook-signature") ?? "");
	if (!(await anyMatches(secretBytes, signed, candidates))) return REFUSED;
	if (!isRecentTimestamp(timestamp, now)) return { ok: false, status: 400 };
	return { ok: true, delivery: id };
}

/** webhook-signature: "v1,<base64>" entries, space separated; any other entry is skipped. */
function standardCandidates(value: string): Uint8Array[] {
	return value
		.split(" ")
		.map((entry) => {
			const [version, signature] = entry.split(",", 2);
			return version === "v1" && signature ? fromBase64(signature) : null;
		})
		.filter((expected) => expected !== null);
}

/** No signature: the secret is the last part of the address. */
async function checkPathSecret({
	secret,
	pathSecret,
}: SignedRequest): Promise<Check> {
	return pathSecret !== undefined && sameSecret(pathSecret, secret)
		? { ok: true }
		: REFUSED;
}

function eventId(body: ArrayBuffer): string | undefined {
	const id = (parseJsonBody(body) as { id?: unknown } | null | undefined)?.id;
	return typeof id === "string" ? id : undefined;
}

/**
 * For a sender without a signed delivery id: the same body twice is the same delivery. The relay
 * forgets deliveries after 7 days, so the same body replayed later is kept again: accepted.
 */
export async function bodyHash(body: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", body);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

import { hexToBytes, hmacMatches } from "../../shared/crypto";

const encoder = new TextEncoder();

/** Linear-Signature is the hex HMAC-SHA256 of the raw body, keyed with the webhook's signing secret. */
export async function verifySignature(
	body: ArrayBuffer,
	signatureHex: string | null,
	secret: string,
): Promise<boolean> {
	if (!signatureHex || !/^[0-9a-f]{64}$/i.test(signatureHex)) return false;
	return hmacMatches(encoder.encode(secret), body, hexToBytes(signatureHex));
}

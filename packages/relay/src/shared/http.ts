/** The largest body the relay keeps, in bytes. */
export const MAX_BODY = 1024 * 1024;

/**
 * The body of a hook, or null past MAX_BODY. Counted as it is read: a chunked body, or one whose
 * Content-Length lies, stops at the limit instead of filling the memory.
 */
export async function readBody(request: Request): Promise<ArrayBuffer | null> {
	const length = request.headers.get("Content-Length");
	if (length !== null && !(/^\d+$/.test(length) && Number(length) <= MAX_BODY))
		return null;
	if (!request.body) return new ArrayBuffer(0);
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return new Blob(chunks).arrayBuffer();
		size += value.byteLength;
		if (size > MAX_BODY) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
}

/** A body's JSON, or undefined when it is not JSON (an empty body is not). */
export function parseJsonBody(body: ArrayBuffer): unknown {
	try {
		return JSON.parse(new TextDecoder().decode(body));
	} catch {
		return undefined;
	}
}

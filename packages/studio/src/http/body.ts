import type { IncomingMessage } from "node:http";

/** The request's body, or undefined once it passes `max` bytes: the rest is not read. */
export async function readBody(
	req: IncomingMessage,
	max: number,
): Promise<Buffer | undefined> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req as AsyncIterable<Buffer>) {
		size += chunk.length;
		if (size > max) return undefined;
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

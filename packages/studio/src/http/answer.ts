import type { ServerResponse } from "node:http";

/**
 * A response as data, written in one place: `send`. Never cached: every answer is what the
 * server knows now.
 */
export interface Answer {
	status: number;
	/** set-cookie may be several. */
	headers: Record<string, string | string[]>;
	body?: string | Buffer;
}

export const textAnswer = (
	status: number,
	type: string,
	body: string | Buffer,
): Answer => ({
	status,
	headers: { "content-type": type, "cache-control": "no-store" },
	body,
});

export const jsonAnswer = (status: number, data: unknown): Answer =>
	textAnswer(status, "application/json", JSON.stringify(data));

/** An error as JSON: `{ error }`. */
export const errorAnswer = (status: number, error: string): Answer =>
	jsonAnswer(status, { error });

/** 204, after a delete. */
export const noContent = (): Answer => ({
	status: 204,
	headers: { "cache-control": "no-store" },
});

/** 303 to `location`, setting the session cookie: after the printed address or the sign-in form. */
export const signInRedirect = (location: string, cookie: string): Answer => ({
	status: 303,
	headers: { location, "set-cookie": cookie, "cache-control": "no-store" },
});

export function send(res: ServerResponse, { status, headers, body }: Answer) {
	res.writeHead(status, headers);
	res.end(body);
}

/** Sends an error as JSON: `{ error }`. */
export const refuse = (res: ServerResponse, status: number, error: string) =>
	send(res, errorAnswer(status, error));

import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/**
 * The cookie that `GET /?token=` and the password set, named after the studio's port: a browser keeps
 * one cookie jar for every port of 127.0.0.1, and two engines side by side would sign each other out.
 * HttpOnly, so no script reads it, not even the app's.
 */
export const cookieName = (port: number | undefined) =>
	`openfabriq-${port ?? 0}`;

/** The name of the cookie for the studio this request reached. */
export const cookieOf = (req: IncomingMessage) =>
	cookieName(req.socket.localPort);

const digest = (value: string) => createHash("sha256").update(value).digest();

/** In constant time, without telling the length, and whatever characters were sent. */
export const sameToken = (sent: string, expected: string): boolean =>
	timingSafeEqual(digest(sent), digest(expected));

/** Whether the request carries the cookie with this server's token. */
export function signedIn(req: IncomingMessage, token: string): boolean {
	const cookie = cookieOf(req);
	return (req.headers.cookie ?? "").split(";").some((c) => {
		const [name, value] = c.trim().split("=", 2);
		return name === cookie && value !== undefined && sameToken(value, token);
	});
}

/** The cookie that `?token=` and the password set; Secure when the request came by the https address. */
export const sessionCookie = (cookie: string, token: string, secure: boolean) =>
	`${cookie}=${token}; HttpOnly; SameSite=Strict; Path=/${secure ? "; Secure" : ""}`;

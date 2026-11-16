import type { IncomingMessage } from "node:http";

/** The Host names this server answers to: its own on 127.0.0.1, and the studio's address. Against DNS rebinding. */
export const allowedHost = (
	host: string | undefined,
	port: number | undefined,
	url?: URL,
): boolean =>
	(port !== undefined &&
		(host === `127.0.0.1:${port}` || host === `localhost:${port}`)) ||
	(url !== undefined && host === url.host);

/** A write's Origin: absent, or the page of the Host it came through, https on the studio's address. */
export const allowedOrigin = (
	origin: string | undefined,
	host: string,
	url?: URL,
): boolean =>
	origin === undefined ||
	origin === (url && host === url.host ? url.origin : `http://${host}`);

/**
 * Why a request that writes does not come from this server's own page, undefined when it does:
 * Origin is absent or this server, https on the studio's address. The server has
 * already refused any other Host (allowedHost) and any request without its cookie (signedIn),
 * which SameSite keeps off writes from other sites (Strict for the token, Lax for the GitHub session).
 */
export function notFromApp(
	req: IncomingMessage,
	url?: URL,
): string | undefined {
	return allowedOrigin(req.headers.origin, req.headers.host ?? "", url)
		? undefined
		: "Cross-origin requests are refused.";
}

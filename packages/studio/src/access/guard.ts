import type { IncomingMessage } from "node:http";
import {
	type Answer,
	errorAnswer,
	signInRedirect,
	textAnswer,
} from "../http/answer.js";
import { loginPage, studioSignIn } from "./login.js";
import { allowedHost } from "./origin.js";
import { cookieOf, sameToken, sessionCookie } from "./session.js";

const SIGN_IN =
	'Open the studio from the address that "openfabriq start" printed, the one with ?token=.';
const SIGN_IN_AGAIN = "Signed out: reload the page and sign in again.";

/** How this server lets people in: the token of the printed address, and maybe a password, GitHub and an https address. */
export interface Gate {
	token: string;
	password?: string | undefined;
	url?: URL | undefined;
	github?: boolean;
}

/**
 * Host, then the token of the printed address, then the cookie: the answer to a request that
 * goes no further, or undefined when it may reach the routes.
 */
export function checkAccess(
	req: IncomingMessage,
	url: URL,
	known: boolean,
	{ token, password, url: studioUrl, github }: Gate,
): Answer | undefined {
	// A page of another site that rebinds its name to 127.0.0.1 reads nothing.
	const host = req.headers.host;
	if (!allowedHost(host, req.socket.localPort, studioUrl))
		return errorAnswer(403, "Unexpected Host.");
	// The address printed by `start`: the token becomes a cookie, and leaves the address bar.
	const sent = url.searchParams.get("token");
	if (req.method === "GET" && sent !== null && sameToken(sent, token)) {
		const to = new URL(url);
		to.searchParams.delete("token");
		return signInRedirect(
			// One leading slash: never a //host/ address.
			`${to.pathname.replace(/^\/+/, "/")}${to.search}`,
			sessionCookie(
				cookieOf(req),
				token,
				studioUrl !== undefined && host === studioUrl.host,
			),
		);
	}
	if (url.pathname.startsWith("/api/") && !known)
		return errorAnswer(401, password || github ? SIGN_IN_AGAIN : SIGN_IN);
	return undefined;
}

/** The app's page to who is not signed in: the sign-in page with a password or GitHub, otherwise how to get in. */
export const signedOutPage = (
	password: string | undefined,
	github = false,
): Answer =>
	password || github
		? textAnswer(
				401,
				"text/html; charset=utf-8",
				loginPage("", studioSignIn(Boolean(password), github)),
			)
		: textAnswer(401, "text/plain; charset=utf-8", SIGN_IN);

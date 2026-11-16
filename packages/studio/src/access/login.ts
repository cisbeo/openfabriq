import type { IncomingMessage, ServerResponse } from "node:http";
import { send, signInRedirect, textAnswer } from "../http/answer.js";
import { readBody } from "../http/body.js";
import type { WriteRoute } from "../routes.js";
import { allowedOrigin } from "./origin.js";
import { cookieOf, sameToken, sessionCookie } from "./session.js";

/**
 * Wrong passwords of the last 10 minutes: 10 per address, so that a stranger on the public domain
 * does not lock the team out, and 100 for the whole server, because code in a sandbox reaches
 * 127.0.0.1 and can write any address in the header.
 */
export function failedLogins(
	limit = 10,
	overall = 100,
	windowMs = 10 * 60_000,
) {
	// Older failures are dropped on each call; none is added once blocked, so the list stays small.
	let failures: { at: number; from: string }[] = [];
	const recent = (now: number) => {
		failures = failures.filter((f) => now - f.at < windowMs);
		return failures;
	};
	return {
		add: (now: number, from: string) => {
			recent(now).push({ at: now, from });
		},
		blocked: (now: number, from: string) =>
			recent(now).length >= overall ||
			failures.filter((f) => f.from === from).length >= limit,
	};
}

/**
 * Who a sign-in comes from: on the studio's domain, the last address of X-Forwarded-For, the one
 * the proxy in front of the engine added (a client writes only the start of the header);
 * otherwise "local", one count for 127.0.0.1, the tunnel and the sandbox.
 */
export function clientAddress(req: IncomingMessage, url?: URL): string {
	const forwarded = req.headers["x-forwarded-for"];
	const last = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded)
		?.split(",")
		.at(-1)
		?.trim();
	return url !== undefined && req.headers.host === url.host && last
		? last
		: "local";
}

/** What the sign-in form posts, and says above the password: the studio's, or the connector's. */
export interface SignInForm {
	/** Where the form posts; no form without it. */
	action?: string;
	heading: string;
	intro?: string;
	button?: string;
	/** A value of the server's own, never text from the request. */
	hidden?: Record<string, string>;
	/** The form asks for the password; true by default. */
	password?: boolean;
	/** Where "Sign in with GitHub" goes, when the studio has it: a path of its own. */
	github?: string;
}

/** The studio's sign-in: the password's form, GitHub's button, or both. */
export const studioSignIn = (
	password: boolean,
	github: boolean,
): SignInForm => ({
	heading: "openfabriq studio",
	...(password ? { action: "/login" } : {}),
	...(github ? { github: "/auth/github" } : {}),
});

/** The sign-in page: no data, no token, and no text from the request. */
export const loginPage = (message: string, form: SignInForm) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>openfabriq studio</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#fafafa;color:#18181b}
main,form{display:grid;gap:12px;width:min(320px,calc(100vw - 32px))}
input,button,.button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid #d4d4d8}
button,.button{background:#18181b;color:#fff;border:0;cursor:pointer;text-align:center;text-decoration:none}
p{margin:0}.error{color:#b91c1c}
@media (prefers-color-scheme:dark){body{background:#09090b;color:#fafafa}input{background:#18181b;color:#fafafa;border-color:#3f3f46}button,.button{background:#fafafa;color:#09090b}}
</style>
</head>
<body>
<main>
<h1 style="font-size:20px;margin:0">${form.heading}</h1>
${form.intro ? `<p>${form.intro}</p>\n` : ""}${form.github ? `<a class="button" href="${form.github}">Sign in with GitHub</a>\n` : ""}${
	form.action
		? `<form method="post" action="${form.action}">
${Object.entries(form.hidden ?? {})
	.map(
		([name, value]) =>
			`<input type="hidden" name="${name}" value="${value}">\n`,
	)
	.join("")}${
	form.password === false
		? ""
		: `<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required${form.github ? "" : " autofocus"}>
`
}<button type="submit">${form.button ?? "Sign in"}</button>
</form>
`
		: ""
}${message ? `<p class="error" role="alert">${message}</p>\n` : ""}</main>
</body>
</html>
`;

const MAX_FORM = 4 * 1024;

/**
 * POST /login: the right password sets the cookie and goes to the studio. Refused from another
 * site's page, past 10 wrong passwords in 10 minutes (even the right one), and when not a small form.
 */
export function loginHandler(deps: {
	password: string;
	token: string;
	url?: URL;
	now?: () => number;
	/** Shared with the connector's sign-in: both take the same password. */
	failures?: ReturnType<typeof failedLogins>;
	/** The page offers sign-in with GitHub too. */
	github?: boolean;
}) {
	const failures = deps.failures ?? failedLogins();
	const now = deps.now ?? Date.now;
	return async (req: IncomingMessage, res: ServerResponse) => {
		const page = (status: number, message: string) =>
			send(
				res,
				textAnswer(
					status,
					"text/html; charset=utf-8",
					loginPage(message, studioSignIn(true, deps.github ?? false)),
				),
			);
		const host = req.headers.host ?? "";
		if (!allowedOrigin(req.headers.origin, host, deps.url))
			return page(403, "Sign in from the studio's own page.");
		const type = req.headers["content-type"]?.split(";")[0]?.trim();
		if (type?.toLowerCase() !== "application/x-www-form-urlencoded")
			return page(415, "Sign in with the form.");
		const form = await readBody(req, MAX_FORM);
		if (!form) return page(413, "Too long.");
		const from = clientAddress(req, deps.url);
		if (failures.blocked(now(), from))
			return page(429, "Too many wrong passwords: try again in 10 minutes.");
		const sent =
			new URLSearchParams(form.toString("utf8")).get("password") ?? "";
		if (!sameToken(sent, deps.password)) {
			failures.add(now(), from);
			return page(401, "Wrong password.");
		}
		send(
			res,
			signInRedirect(
				"/",
				sessionCookie(
					cookieOf(req),
					deps.token,
					deps.url !== undefined && host === deps.url.host,
				),
			),
		);
	};
}

/** POST /logout: forgets the cookies of this browser, then the sign-in page. From the studio's own page only. */
export const logoutHandler =
	(deps: { url?: URL; cookies?: string[] }): WriteRoute =>
	async (req, res) => {
		if (!allowedOrigin(req.headers.origin, req.headers.host ?? "", deps.url))
			return send(
				res,
				textAnswer(
					403,
					"text/plain; charset=utf-8",
					"Sign out from the studio's own page.",
				),
			);
		send(res, {
			status: 303,
			headers: {
				location: "/",
				"set-cookie": [
					`${cookieOf(req)}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
					...(deps.cookies ?? []),
				],
				"cache-control": "no-store",
			},
		});
	};

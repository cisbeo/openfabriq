import type { IncomingMessage, ServerResponse } from "node:http";
import { errorText, type GitHubApp } from "@openfabriq/runner";
import { newSecret, seal, tokenKey, unseal } from "../connector/oauth.js";
import { type Answer, send, textAnswer } from "../http/answer.js";
import type { WriteRoute } from "../routes.js";
import { loginPage } from "./login.js";
import { sameToken } from "./session.js";

// Sign-in with GitHub, through the team's GitHub App: who has write access to a repository of the
// factory enters. The person's GitHub token is used once, to learn the login, then dropped; the
// engine asks again with its own installation token when the hour of a session ends.

/** A session is checked again with GitHub every hour, and lasts a week at most. */
export const SESSION_MS = 3600_000;
export const SESSION_MAX_MS = 7 * 24 * 3600_000;
const SESSION = "openfabriq-session";
const STATE = "openfabriq-github-state";
const HTML = "text/html; charset=utf-8";
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** A path of the studio: never //host or \host, which a browser reads as another site. */
const LOCAL_PATH = /^\/(?![/\\])/;

/** The value of a cookie of the request, or undefined. */
export function cookieValue(
	req: IncomingMessage,
	name: string,
): string | undefined {
	for (const part of (req.headers.cookie ?? "").split(";")) {
		const [key, value] = part.trim().split("=", 2);
		if (key === name) return value;
	}
	return undefined;
}

/**
 * Whether this login may enter: write access (write, maintain or admin) to one of the
 * repositories, as GitHub tells the app. Throws when GitHub answered for none of them.
 */
export async function writerOf(
	app: Pick<GitHubApp, "token">,
	repositories: string[],
	login: string,
	fetchFn: typeof fetch = fetch,
): Promise<boolean> {
	let answered = false;
	let failure: unknown;
	for (const repository of repositories) {
		try {
			const response = await fetchFn(
				`https://api.github.com/repos/${repository}/collaborators/${encodeURIComponent(login)}/permission`,
				{
					headers: {
						Accept: "application/vnd.github+json",
						Authorization: `Bearer ${await app.token(repository)}`,
					},
				},
			);
			// Not a collaborator of a private repository.
			if (response.status === 404) {
				answered = true;
				continue;
			}
			if (!response.ok)
				throw new Error(`GitHub answered ${response.status} for ${repository}`);
			answered = true;
			// maintain is "write" here, triage is "read".
			const { permission } = (await response.json()) as { permission?: string };
			if (permission === "admin" || permission === "write") return true;
		} catch (error) {
			failure = error;
		}
	}
	if (!answered && failure !== undefined) throw failure;
	return false;
}

/** The sign-in with GitHub of the studio on its https address: its routes, and who a request is. */
export function githubSignIn(deps: {
	clientId: string;
	clientSecret: string;
	url: URL;
	/** writerOf, for the factory's repositories. */
	writer: (login: string) => Promise<boolean>;
	now?: () => number;
	fetch?: typeof fetch;
}) {
	const now = deps.now ?? Date.now;
	const fetchFn = deps.fetch ?? fetch;
	const key = tokenKey(deps.clientSecret, "openfabriq studio session");
	const callback = `${deps.url.origin}/auth/github/callback`;
	/** deps.writer, false when GitHub cannot say: the reason goes to the engine's log, not lost. */
	const stillWriter = (login: string) =>
		deps.writer(login).catch((error: unknown) => {
			process.stderr.write(
				`openfabriq: GitHub could not say whether ${login} may still enter, so they are signed out: ${errorText(error)}\n`,
			);
			return false;
		});
	// Lax: GitHub sends the person back from its own site, and a Strict cookie stays home then.
	const stateCookie = (value: string, seconds: number) =>
		`${STATE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/auth/github; Max-Age=${seconds}`;
	const sessionCookie = (login: string, since: number) =>
		`${SESSION}=${seal(key, "session", { login, since, exp: now() + SESSION_MS })}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.ceil((since + SESSION_MAX_MS - now()) / 1000)}`;

	/** The person's login, from the code GitHub gave back; their token is not kept. */
	async function loginOf(code: string): Promise<string> {
		const response = await fetchFn(
			"https://github.com/login/oauth/access_token",
			{
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					client_id: deps.clientId,
					client_secret: deps.clientSecret,
					code,
					redirect_uri: callback,
				}),
			},
		);
		const token = (await response.json().catch(() => ({}))) as {
			access_token?: string;
			error?: string;
		};
		if (!token.access_token)
			throw new Error(
				`GitHub gave no token (${token.error ?? response.status})`,
			);
		const user = await fetchFn("https://api.github.com/user", {
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${token.access_token}`,
			},
		});
		const { login } = (await user.json().catch(() => ({}))) as {
			login?: unknown;
		};
		if (!user.ok || typeof login !== "string" || !LOGIN.test(login))
			throw new Error(`GitHub did not say who signed in (${user.status})`);
		return login;
	}

	const page = (status: number, message: string): Answer => {
		const answer = textAnswer(
			status,
			HTML,
			loginPage(message, {
				heading: "openfabriq studio",
				github: "/auth/github",
			}),
		);
		return {
			...answer,
			headers: { ...answer.headers, "set-cookie": stateCookie("", 0) },
		};
	};

	/** GET /auth/github?to=<path>: to GitHub, then back to that path of the studio. */
	const start: WriteRoute = async (req, res) => {
		const to = new URL(req.url ?? "/", deps.url).searchParams.get("to") ?? "/";
		const state = `${newSecret()}.${Buffer.from(LOCAL_PATH.test(to) ? to : "/").toString("base64url")}`;
		const authorize = new URL("https://github.com/login/oauth/authorize");
		authorize.searchParams.set("client_id", deps.clientId);
		authorize.searchParams.set("redirect_uri", callback);
		authorize.searchParams.set("state", state);
		send(res, {
			status: 302,
			headers: {
				location: authorize.href,
				"set-cookie": stateCookie(state, 600),
				"cache-control": "no-store",
			},
		});
	};

	/** GET /auth/github/callback: the state this browser was given, then the login and its access. */
	const back: WriteRoute = async (req, res) => {
		const q = new URL(req.url ?? "/", deps.url).searchParams;
		const state = q.get("state") ?? "";
		const kept = cookieValue(req, STATE);
		const code = q.get("code");
		if (!code || !kept || !sameToken(state, kept))
			return send(res, page(400, "This sign-in has expired: sign in again."));
		let login: string;
		let allowed: boolean;
		try {
			login = await loginOf(code);
			allowed = await deps.writer(login);
		} catch (error) {
			process.stderr.write(
				`openfabriq: sign-in with GitHub failed: ${errorText(error)}\n`,
			);
			return send(
				res,
				page(
					502,
					"GitHub could not be asked: try again, or see the engine's log.",
				),
			);
		}
		if (!allowed)
			return send(
				res,
				page(
					403,
					`${login} has no write access to a repository of this factory.`,
				),
			);
		const to = Buffer.from(state.split(".")[1] ?? "", "base64url").toString(
			"utf8",
		);
		send(res, {
			status: 303,
			headers: {
				location: LOCAL_PATH.test(to) ? to : "/",
				"set-cookie": [stateCookie("", 0), sessionCookie(login, now())],
				"cache-control": "no-store",
			},
		});
	};

	return {
		routes: {
			"GET /auth/github": start,
			"GET /auth/github/callback": back,
		} as Record<string, WriteRoute>,
		/**
		 * The login of a signed-in request, or undefined. Past its hour, a session asks GitHub again
		 * and carries on with a new cookie; past a week, or without access, it is over.
		 */
		async session(
			req: IncomingMessage,
			res: ServerResponse,
		): Promise<string | undefined> {
			const value = cookieValue(req, SESSION);
			const data =
				value === undefined ? undefined : unseal(key, "session", value);
			const { login, since, exp } = data ?? {};
			if (
				typeof login !== "string" ||
				typeof since !== "number" ||
				typeof exp !== "number"
			)
				return undefined;
			if (now() < exp) return login;
			if (now() - since >= SESSION_MAX_MS) return undefined;
			if (!(await stillWriter(login))) return undefined;
			res.appendHeader("set-cookie", sessionCookie(login, since));
			return login;
		},
		/** For the connector: the key of its tokens, and who may still allow Claude. */
		secret: deps.clientSecret,
		writer: stillWriter,
		/** The cookie that ends a session. */
		signOutCookie: `${SESSION}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
	};
}

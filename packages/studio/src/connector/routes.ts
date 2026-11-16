import type { IncomingMessage, ServerResponse } from "node:http";
import {
	answerMessage,
	type factoryMcpServer,
	type McpMessage,
} from "@openfabriq/runner";
import {
	clientAddress,
	type failedLogins,
	loginPage,
	type SignInForm,
} from "../access/login.js";
import { allowedOrigin } from "../access/origin.js";
import { sameToken } from "../access/session.js";
import { type Answer, jsonAnswer, send, textAnswer } from "../http/answer.js";
import { readBody } from "../http/body.js";
import type { WriteRoute } from "../routes.js";
import { grantsFile } from "./grants.js";
import {
	ACCESS_SECONDS,
	authorizationServer,
	CODE_MS,
	connectorUrls,
	newSecret,
	pkceMatches,
	protectedResource,
	readAccess,
	redirectTarget,
	refreshHash,
	signAccess,
	tokenKey,
} from "./oauth.js";

/** An authorization the maintainer has not signed yet, or a code not yet taken. */
interface Pending {
	clientId: string;
	redirect: string;
	challenge: string;
	state: string | null;
	target: string;
	expiresAt: number;
	/** Who allowed it, with sign-in by GitHub. */
	login?: string;
}

const PENDING_MS = 10 * 60_000;
/** Kept in memory: anyone can open the sign-in page, so the lists are capped. */
const MAX_PENDING = 100;
const MAX_FORM = 4 * 1024;
const MAX_MESSAGE = 1024 * 1024;
const CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;
const HTML = "text/html; charset=utf-8";

/** A map whose entries expire, never past `MAX_PENDING`: the oldest go first. */
function expiring(now: () => number) {
	const entries = new Map<string, Pending>();
	return {
		add(key: string, value: Pending) {
			for (const [k, v] of entries)
				if (v.expiresAt <= now() || entries.size >= MAX_PENDING)
					entries.delete(k);
			entries.set(key, value);
		},
		/** The entry, once: a second take finds nothing. */
		take(key: string) {
			const value = entries.get(key);
			entries.delete(key);
			return value && value.expiresAt > now() ? value : undefined;
		},
		get(key: string) {
			const value = entries.get(key);
			return value && value.expiresAt > now() ? value : undefined;
		},
	};
}

const typeOf = (req: IncomingMessage) =>
	req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();

const oauthError = (error: string, description?: string) =>
	jsonAnswer(400, {
		error,
		...(description ? { error_description: description } : {}),
	});

/** Sign-in by GitHub for the connector: who allows Claude, and whether they still may. */
export interface ConnectorGitHub {
	/** The GitHub App's client secret: it signs the tokens. */
	secret: string;
	session: (
		req: IncomingMessage,
		res: ServerResponse,
	) => Promise<string | undefined>;
	/** Never throws: false when GitHub cannot say. */
	writer: (login: string) => Promise<boolean>;
}

/**
 * The connector on the studio's domain: `/mcp` for Claude, behind OAuth allowed by a person signed
 * in with GitHub, or else by the studio's password. Read only: `/mcp` serves the tools of
 * `openfabriq mcp`.
 */
export function connectorRoutes(deps: {
	password?: string | undefined;
	github?: ConnectorGitHub | undefined;
	url: URL;
	failures: ReturnType<typeof failedLogins>;
	server: () => ReturnType<typeof factoryMcpServer>;
	grantsPath: string;
	now?: () => number;
}): Record<string, WriteRoute> {
	const now = deps.now ?? Date.now;
	const urls = connectorUrls(deps.url);
	// GitHub wins when both are set: a person allows Claude, not a shared secret.
	const key = tokenKey(deps.github?.secret ?? deps.password ?? "");
	const grants = grantsFile(deps.grantsPath);
	const pending = expiring(now);
	const codes = expiring(now);
	const answer =
		(reply: () => Answer): WriteRoute =>
		async (_req, res) =>
			send(res, reply());

	const signInPage = (
		status: number,
		id: string,
		target: string,
		message = "",
		/** Signed in with GitHub: the page asks only for the click. */
		login?: string,
	) => {
		const asks = `${target} asks to read this engine's factories: their runs, transcripts, numbers and board. It changes nothing.`;
		const form: SignInForm = !deps.github
			? {
					action: "/oauth/authorize",
					heading: "Connect openfabriq",
					intro: `${asks} Type the studio's password to allow it.`,
					button: "Allow",
					hidden: { request: id },
				}
			: login
				? {
						action: "/oauth/authorize",
						heading: "Connect openfabriq",
						intro: `${asks} You are signed in as ${login}.`,
						button: "Allow",
						hidden: { request: id },
						password: false,
					}
				: {
						heading: "Connect openfabriq",
						intro: `${asks} Sign in with GitHub to allow it.`,
						github: `/auth/github?to=${encodeURIComponent(`/oauth/authorize?request=${id}`)}`,
					};
		return textAnswer(status, HTML, loginPage(message, form));
	};
	const plainPage = (status: number, text: string) =>
		textAnswer(status, "text/plain; charset=utf-8", text);
	const backTo = (redirect: string, fields: Record<string, string | null>) => {
		const to = new URL(redirect);
		for (const [name, value] of Object.entries(fields))
			if (value !== null) to.searchParams.set(name, value);
		to.searchParams.set("iss", urls.issuer);
		return {
			status: 303,
			headers: { location: to.toString(), "cache-control": "no-store" },
		} satisfies Answer;
	};
	const sameResource = (resource: string | null) =>
		resource === null || resource.replace(/\/+$/, "") === urls.resource;

	const tokensFor = (grant: string, refresh: string) =>
		jsonAnswer(200, {
			access_token: signAccess(key, grant, now()),
			token_type: "Bearer",
			expires_in: ACCESS_SECONDS,
			refresh_token: refresh,
		});

	const authorizeGet: WriteRoute = async (req, res) => {
		const q = new URL(req.url ?? "/", urls.issuer).searchParams;
		// Back from GitHub: the same request, now signed in.
		const resumed = q.get("request");
		if (resumed !== null) {
			const asked = pending.get(resumed);
			if (!asked)
				return send(
					res,
					plainPage(
						400,
						"This sign-in has expired: connect again from Claude.",
					),
				);
			const login = await deps.github?.session(req, res);
			return send(res, signInPage(200, resumed, asked.target, "", login));
		}
		const redirect = q.get("redirect_uri") ?? "";
		const target = redirectTarget(redirect);
		const clientId = q.get("client_id");
		if (!target || !clientId)
			return send(
				res,
				plainPage(400, "This sign-in link does not come from Claude."),
			);
		const state = q.get("state");
		const refuse = (error: string) =>
			send(res, backTo(redirect, { error, state }));
		if (q.get("response_type") !== "code")
			return refuse("unsupported_response_type");
		const challenge = q.get("code_challenge") ?? "";
		if (q.get("code_challenge_method") !== "S256" || !CHALLENGE.test(challenge))
			return refuse("invalid_request");
		if (!sameResource(q.get("resource"))) return refuse("invalid_target");
		const id = newSecret();
		pending.add(id, {
			clientId,
			redirect,
			challenge,
			state,
			target,
			expiresAt: now() + PENDING_MS,
		});
		send(res, signInPage(200, id, target));
	};

	const authorizePost: WriteRoute = async (req, res) => {
		if (!allowedOrigin(req.headers.origin, req.headers.host ?? "", deps.url))
			return send(res, plainPage(403, "Sign in from the studio's own page."));
		if (typeOf(req) !== "application/x-www-form-urlencoded")
			return send(res, plainPage(415, "Sign in with the form."));
		const body = await readBody(req, MAX_FORM);
		if (!body) return send(res, plainPage(413, "Too long."));
		const fields = new URLSearchParams(body.toString("utf8"));
		const id = fields.get("request") ?? "";
		const asked = pending.get(id);
		if (!asked)
			return send(
				res,
				plainPage(400, "This sign-in has expired: connect again from Claude."),
			);
		if (deps.github) {
			const login = await deps.github.session(req, res);
			if (!login)
				return send(
					res,
					signInPage(401, id, asked.target, "Sign in with GitHub first."),
				);
			pending.take(id);
			const code = newSecret();
			codes.add(code, { ...asked, login, expiresAt: now() + CODE_MS });
			return send(res, backTo(asked.redirect, { code, state: asked.state }));
		}
		const from = clientAddress(req, deps.url);
		if (deps.failures.blocked(now(), from))
			return send(
				res,
				signInPage(
					429,
					id,
					asked.target,
					"Too many wrong passwords: try again in 10 minutes.",
				),
			);
		if (!sameToken(fields.get("password") ?? "", deps.password ?? "")) {
			deps.failures.add(now(), from);
			return send(res, signInPage(401, id, asked.target, "Wrong password."));
		}
		pending.take(id);
		const code = newSecret();
		codes.add(code, { ...asked, expiresAt: now() + CODE_MS });
		send(res, backTo(asked.redirect, { code, state: asked.state }));
	};

	const token: WriteRoute = async (req, res) => {
		if (typeOf(req) !== "application/x-www-form-urlencoded")
			return send(res, oauthError("invalid_request", "Send a form."));
		const body = await readBody(req, MAX_FORM);
		if (!body) return send(res, oauthError("invalid_request", "Too long."));
		const fields = new URLSearchParams(body.toString("utf8"));
		const grantType = fields.get("grant_type");
		if (grantType === "authorization_code") {
			const code = codes.take(fields.get("code") ?? "");
			const valid =
				code !== undefined &&
				fields.get("redirect_uri") === code.redirect &&
				fields.get("client_id") === code.clientId &&
				sameResource(fields.get("resource")) &&
				pkceMatches(fields.get("code_verifier") ?? "", code.challenge);
			if (!valid) return send(res, oauthError("invalid_grant"));
			const refresh = newSecret();
			const grant = grants.add(
				refreshHash(key, refresh),
				code.clientId,
				now(),
				code.login,
			);
			return send(res, tokensFor(grant, refresh));
		}
		if (grantType === "refresh_token") {
			const refresh = newSecret();
			const grant = grants.rotate(
				refreshHash(key, fields.get("refresh_token") ?? ""),
				refreshHash(key, refresh),
				now(),
			);
			if (!grant) return send(res, oauthError("invalid_grant"));
			// Removed from the repositories on GitHub: Claude loses the access within the hour.
			if (deps.github) {
				const login = grants.loginOf(grant, now());
				if (!login || !(await deps.github.writer(login)))
					return send(res, oauthError("invalid_grant"));
			}
			return send(res, tokensFor(grant, refresh));
		}
		send(res, oauthError("unsupported_grant_type"));
	};

	const register: WriteRoute = async (req, res) => {
		const body =
			typeOf(req) === "application/json" && (await readBody(req, MAX_FORM));
		let redirects: unknown;
		try {
			redirects = body && JSON.parse(body.toString("utf8")).redirect_uris;
		} catch {}
		if (
			!Array.isArray(redirects) ||
			redirects.length === 0 ||
			!redirects.every((r) => typeof r === "string" && redirectTarget(r))
		)
			return send(
				res,
				oauthError(
					"invalid_redirect_uri",
					"Only Claude and Claude Code can connect.",
				),
			);
		// Nothing is kept: the authorization checks the address again.
		send(
			res,
			jsonAnswer(201, {
				client_id: newSecret(),
				client_id_issued_at: Math.floor(now() / 1000),
				redirect_uris: redirects,
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				token_endpoint_auth_method: "none",
			}),
		);
	};

	const mcp: WriteRoute = async (req, res) => {
		// A browser page of another site never reads the tools.
		if (req.headers.origin !== undefined && req.headers.origin !== urls.issuer)
			return send(res, jsonAnswer(403, { error: "Unexpected Origin." }));
		const bearer = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
		const grant = bearer && readAccess(key, bearer, now());
		if (!grant || !grants.has(grant, now()))
			return send(res, {
				status: 401,
				headers: {
					"www-authenticate": `Bearer resource_metadata="${urls.resourceMetadata}"${bearer ? ', error="invalid_token"' : ""}`,
					"cache-control": "no-store",
				},
			});
		if (typeOf(req) !== "application/json")
			return send(res, jsonAnswer(415, { error: "Send JSON-RPC as JSON." }));
		const body = await readBody(req, MAX_MESSAGE);
		if (!body) return send(res, jsonAnswer(413, { error: "Too long." }));
		const message = jsonRpc(body);
		if (!message)
			return send(
				res,
				jsonAnswer(400, {
					jsonrpc: "2.0",
					id: null,
					error: { code: -32600, message: "One JSON-RPC message per request." },
				}),
			);
		if (!("method" in message)) return send(res, { status: 202, headers: {} });
		const answered = await answerMessage(deps.server(), message);
		send(
			res,
			answered ? jsonAnswer(200, answered) : { status: 202, headers: {} },
		);
	};
	const onlyPost = answer(() => ({
		status: 405,
		headers: { allow: "POST", "cache-control": "no-store" },
	}));

	return {
		"GET /.well-known/oauth-protected-resource": answer(() =>
			jsonAnswer(200, protectedResource(deps.url)),
		),
		"GET /.well-known/oauth-protected-resource/mcp": answer(() =>
			jsonAnswer(200, protectedResource(deps.url)),
		),
		"GET /.well-known/oauth-authorization-server": answer(() =>
			jsonAnswer(200, authorizationServer(deps.url)),
		),
		"POST /oauth/register": register,
		"GET /oauth/authorize": authorizeGet,
		"POST /oauth/authorize": authorizePost,
		"POST /oauth/token": token,
		"POST /mcp": mcp,
		"GET /mcp": onlyPost,
		"DELETE /mcp": onlyPost,
	};
}

/** A request, a notification or a response, as one JSON-RPC 2.0 object; undefined otherwise. */
function jsonRpc(body: Buffer): McpMessage | undefined {
	let message: unknown;
	try {
		message = JSON.parse(body.toString("utf8"));
	} catch {
		return undefined;
	}
	if (
		typeof message !== "object" ||
		message === null ||
		Array.isArray(message) ||
		!("jsonrpc" in message) ||
		message.jsonrpc !== "2.0"
	)
		return undefined;
	const id = "id" in message ? message.id : undefined;
	const validId = typeof id === "string" || typeof id === "number";
	if ("method" in message)
		return typeof message.method === "string" && (id === undefined || validId)
			? (message as McpMessage)
			: undefined;
	return validId && ("result" in message || "error" in message)
		? (message as McpMessage)
		: undefined;
}

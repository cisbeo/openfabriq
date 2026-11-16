import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { type IncomingHttpHeaders, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	appendRun,
	home,
	readFactoryFolder,
	writeApplied,
} from "@openfabriq/runner";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startStudio } from "../../src/server.js";

const PASSWORD = "correct horse battery staple";
const DOMAIN = "factory.example.com";
const ORIGIN = `https://${DOMAIN}`;
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const FORM = "application/x-www-form-urlencoded";
const VERIFIER = "v".repeat(50);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
let studio: ReturnType<typeof startStudio>;
let local: ReturnType<typeof startStudio>;

beforeAll(async () => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	writeApplied(
		"acme/task-app",
		readFactoryFolder(
			join(import.meta.dirname, "../../../../fixtures/valid/sdlc/openfabriq"),
		),
	);
	appendRun({
		id: "run-1",
		repository: "acme/task-app",
		automation: "implement-ready-issues",
		agent: "implementer",
		event: "issue.labeled",
		isPullRequest: false,
		status: "failed",
		queuedAt: new Date().toISOString(),
		outputs: [],
	});
	const app = mkdtempSync(join(tmpdir(), "openfabriq-app-"));
	studio = startStudio(0, app, {
		access: { password: PASSWORD, url: new URL(ORIGIN) },
	});
	local = startStudio(0, app, { access: { password: PASSWORD } });
	await Promise.all(
		[studio, local].map((s) => new Promise((ok) => s.once("listening", ok))),
	);
});
afterAll(() => {
	studio.close();
	local.close();
});

interface Reply {
	status: number;
	text: string;
	headers: IncomingHttpHeaders;
}

/** A request to the studio as its proxy passes it on: Host is the studio's domain. */
function send(
	path: string,
	options: {
		method?: string;
		headers?: Record<string, string>;
		body?: string;
		to?: typeof studio;
	} = {},
): Promise<Reply> {
	const { port } = (options.to ?? studio).address() as AddressInfo;
	return new Promise((ok, ko) => {
		const req = request(
			{
				host: "127.0.0.1",
				port,
				path,
				method: options.method ?? "GET",
				headers: { host: DOMAIN, ...options.headers },
			},
			(res) => {
				let text = "";
				res.on("data", (c) => {
					text += c;
				});
				res.on("end", () =>
					ok({ status: res.statusCode ?? 0, text, headers: res.headers }),
				);
			},
		);
		req.on("error", ko);
		req.end(options.body);
	});
}

const form = (path: string, fields: Record<string, string>, origin?: string) =>
	send(path, {
		method: "POST",
		headers: { "content-type": FORM, ...(origin ? { origin } : {}) },
		body: new URLSearchParams(fields).toString(),
	});

const authorizeQuery = (fields: Record<string, string> = {}) =>
	new URLSearchParams({
		response_type: "code",
		client_id: "client-1",
		redirect_uri: CALLBACK,
		code_challenge: CHALLENGE,
		code_challenge_method: "S256",
		state: "st",
		resource: `${ORIGIN}/mcp`,
		...fields,
	}).toString();

/** The sign-in page's hidden field: the pending authorization. */
const pendingOf = (page: string) =>
	/name="request" value="([^"]+)"/.exec(page)?.[1] ?? "";

/** Through the sign-in page, as the maintainer does: the code Claude gets back. */
async function codeFor(fields: Record<string, string> = {}) {
	const page = await send(`/oauth/authorize?${authorizeQuery(fields)}`);
	expect(page.status).toBe(200);
	const allowed = await form(
		"/oauth/authorize",
		{ request: pendingOf(page.text), password: PASSWORD },
		ORIGIN,
	);
	expect(allowed.status).toBe(303);
	const back = new URL(allowed.headers.location ?? "");
	return { back, code: back.searchParams.get("code") ?? "" };
}

const tokens = async (fields: Record<string, string>) => {
	const reply = await form("/oauth/token", fields);
	return { status: reply.status, body: JSON.parse(reply.text) };
};

const exchange = (code: string, fields: Record<string, string> = {}) =>
	tokens({
		grant_type: "authorization_code",
		code,
		code_verifier: VERIFIER,
		redirect_uri: CALLBACK,
		client_id: "client-1",
		resource: `${ORIGIN}/mcp`,
		...fields,
	});

const mcp = (token: string, message: object, headers = {}) =>
	send("/mcp", {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...headers,
		},
		body: JSON.stringify(message),
	});

describe("discovery", () => {
	it("refuses /mcp without a token, and points to its metadata", async () => {
		const reply = await mcp("", {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/list",
		});
		expect(reply.status).toBe(401);
		expect(reply.headers["www-authenticate"]).toBe(
			`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
		);
	});

	it("serves both metadata documents", async () => {
		for (const path of [
			"/.well-known/oauth-protected-resource",
			"/.well-known/oauth-protected-resource/mcp",
		]) {
			const reply = await send(path);
			expect(reply.status).toBe(200);
			expect(JSON.parse(reply.text).resource).toBe(`${ORIGIN}/mcp`);
		}
		const server = JSON.parse(
			(await send("/.well-known/oauth-authorization-server")).text,
		);
		expect(server.issuer).toBe(ORIGIN);
	});

	it("registers a client of Claude or Claude Code, no other", async () => {
		const register = (redirect_uris: string[]) =>
			send("/oauth/register", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ client_name: "Claude", redirect_uris }),
			});
		const ok = await register([CALLBACK]);
		expect(ok.status).toBe(201);
		expect(JSON.parse(ok.text)).toMatchObject({
			redirect_uris: [CALLBACK],
			token_endpoint_auth_method: "none",
		});
		expect(JSON.parse(ok.text).client_id).toMatch(/.{20,}/);
		expect((await register(["http://localhost:3118/callback"])).status).toBe(
			201,
		);
		const evil = await register([CALLBACK, "https://evil.example/cb"]);
		expect(evil.status).toBe(400);
		expect(JSON.parse(evil.text).error).toBe("invalid_redirect_uri");
		expect((await register([])).status).toBe(400);
	});

	it("has no connector without the studio's domain", async () => {
		const { port } = local.address() as AddressInfo;
		const reply = await send("/mcp", {
			method: "POST",
			headers: {
				host: `127.0.0.1:${port}`,
				"content-type": "application/json",
			},
			body: "{}",
			to: local,
		});
		expect(reply.status).toBe(405);
		const metadata = await send("/.well-known/oauth-authorization-server", {
			headers: { host: `127.0.0.1:${port}` },
			to: local,
		});
		expect(metadata.headers["content-type"]).not.toContain("application/json");
	});
});

describe("signing in", () => {
	it("says who gets the access, and asks for the password, echoing nothing of the request", async () => {
		const page = await send(
			`/oauth/authorize?${authorizeQuery({ state: '"><script>x</script>' })}`,
		);
		expect(page.status).toBe(200);
		expect(page.text).toContain("Claude");
		expect(page.text).toContain('type="password"');
		expect(page.text).not.toContain("<script>");
		const code = await send(
			`/oauth/authorize?${authorizeQuery({ redirect_uri: "http://127.0.0.1:4000/callback" })}`,
		);
		expect(code.text).toContain("Claude Code on this computer");
	});

	it("never sends a code to an address outside Claude's", async () => {
		const page = await send(
			`/oauth/authorize?${authorizeQuery({ redirect_uri: "https://evil.example/cb" })}`,
		);
		expect(page.status).toBe(400);
		expect(page.headers.location).toBeUndefined();
	});

	it("sends a wrong request back to Claude with its error", async () => {
		for (const [fields, error] of [
			[{ code_challenge_method: "plain" }, "invalid_request"],
			[{ code_challenge: "" }, "invalid_request"],
			[{ response_type: "token" }, "unsupported_response_type"],
			[{ resource: "https://other.example/mcp" }, "invalid_target"],
		] as const) {
			const reply = await send(`/oauth/authorize?${authorizeQuery(fields)}`);
			expect(reply.status).toBe(303);
			const back = new URL(reply.headers.location ?? "");
			expect(back.origin + back.pathname).toBe(CALLBACK);
			expect(back.searchParams.get("error")).toBe(error);
			expect(back.searchParams.get("state")).toBe("st");
		}
	});

	it("refuses a wrong password, a form from another site, and a stale request", async () => {
		const page = await send(`/oauth/authorize?${authorizeQuery()}`);
		const pending = pendingOf(page.text);
		const wrong = await form(
			"/oauth/authorize",
			{ request: pending, password: "not the password" },
			ORIGIN,
		);
		expect(wrong.status).toBe(401);
		expect(wrong.text).toContain("Wrong password");
		const foreign = await form(
			"/oauth/authorize",
			{ request: pending, password: PASSWORD },
			"https://evil.example",
		);
		expect(foreign.status).toBe(403);
		const unknown = await form(
			"/oauth/authorize",
			{ request: "nope", password: PASSWORD },
			ORIGIN,
		);
		expect(unknown.status).toBe(400);
	});
});

it("counts wrong passwords with the studio's sign-in: past 10, neither takes the right one", async () => {
	const app = mkdtempSync(join(tmpdir(), "openfabriq-app-"));
	const own = startStudio(0, app, {
		access: { password: PASSWORD, url: new URL(ORIGIN) },
	});
	await new Promise((ok) => own.once("listening", ok));
	const post = (path: string, fields: Record<string, string>) =>
		send(path, {
			method: "POST",
			headers: { "content-type": FORM, origin: ORIGIN },
			body: new URLSearchParams(fields).toString(),
			to: own,
		});
	const page = await send(`/oauth/authorize?${authorizeQuery()}`, { to: own });
	const request = pendingOf(page.text);
	for (let i = 0; i < 5; i++)
		expect((await post("/login", { password: `wrong ${i}` })).status).toBe(401);
	for (let i = 0; i < 5; i++)
		expect(
			(await post("/oauth/authorize", { request, password: `wrong ${i}` }))
				.status,
		).toBe(401);
	const blocked = await post("/oauth/authorize", {
		request,
		password: PASSWORD,
	});
	expect(blocked.status).toBe(429);
	expect(blocked.text).toContain("Too many wrong passwords");
	expect((await post("/login", { password: PASSWORD })).status).toBe(429);
	own.close();
});

describe("tokens", () => {
	it("gives Claude a token that reads the factory through /mcp", async () => {
		const { back, code } = await codeFor();
		expect(back.origin + back.pathname).toBe(CALLBACK);
		expect(back.searchParams.get("state")).toBe("st");
		expect(back.searchParams.get("iss")).toBe(ORIGIN);
		const { status, body } = await exchange(code);
		expect(status).toBe(200);
		expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
		const init = await mcp(body.access_token, {
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "test", version: "1" },
			},
		});
		expect(init.status).toBe(200);
		expect(init.headers["content-type"]).toBe("application/json");
		expect(JSON.parse(init.text).result.serverInfo.name).toBe("openfabriq");
		const notified = await mcp(body.access_token, {
			jsonrpc: "2.0",
			method: "notifications/initialized",
		});
		expect(notified.status).toBe(202);
		const runs = await mcp(body.access_token, {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "list_runs", arguments: {} },
		});
		expect(JSON.parse(runs.text).result.content[0].text).toContain("run-1");
		const board = await mcp(body.access_token, {
			jsonrpc: "2.0",
			id: 3,
			method: "tools/list",
		});
		expect(
			JSON.parse(board.text).result.tools.map((t: { name: string }) => t.name),
		).toContain("board");
	});

	it("takes a code once, with its verifier, for its address and client", async () => {
		const { code } = await codeFor();
		expect(
			(await exchange(code, { code_verifier: "w".repeat(50) })).body,
		).toEqual(expect.objectContaining({ error: "invalid_grant" }));
		// Missed once, the code is gone.
		expect((await exchange(code)).status).toBe(400);
		const other = await codeFor();
		expect(
			(await exchange(other.code, { client_id: "client-2" })).body.error,
		).toBe("invalid_grant");
		const third = await codeFor();
		expect(
			(
				await exchange(third.code, {
					redirect_uri: "http://localhost:1/callback",
				})
			).body.error,
		).toBe("invalid_grant");
		expect(
			(await tokens({ grant_type: "password", password: PASSWORD })).body.error,
		).toBe("unsupported_grant_type");
	});

	it("swaps a refresh token, also for a second client at once, and signs everyone out when the grants are deleted", async () => {
		const first = (await exchange((await codeFor()).code)).body;
		const renew = (refresh_token: string) =>
			tokens({
				grant_type: "refresh_token",
				refresh_token,
				client_id: "client-1",
			});
		const refreshed = await renew(first.refresh_token);
		expect(refreshed.status).toBe(200);
		expect(refreshed.body.refresh_token).not.toBe(first.refresh_token);
		// Another session that held the same token renews it too, in the same moment.
		const other = await renew(first.refresh_token);
		expect(other.status).toBe(200);
		expect((await renew(refreshed.body.refresh_token)).status).toBe(200);
		expect((await renew(other.body.refresh_token)).status).toBe(200);
		expect((await renew("never given")).body.error).toBe("invalid_grant");
		const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
		expect((await mcp(refreshed.body.access_token, list)).status).toBe(200);
		rmSync(join(home(), "mcp-grants.json"));
		const out = await mcp(refreshed.body.access_token, list);
		expect(out.status).toBe(401);
		expect(out.headers["www-authenticate"]).toContain('error="invalid_token"');
	});

	it("refuses /mcp from a browser page of another site, and anything but a POST", async () => {
		const { access_token } = (await exchange((await codeFor()).code)).body;
		const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
		expect(
			(await mcp(access_token, list, { origin: "https://evil.example" }))
				.status,
		).toBe(403);
		for (const method of ["GET", "DELETE"])
			expect(
				(
					await send("/mcp", {
						method,
						headers: { authorization: `Bearer ${access_token}` },
					})
				).status,
			).toBe(405);
		const notJson = await send("/mcp", {
			method: "POST",
			headers: {
				authorization: `Bearer ${access_token}`,
				"content-type": "application/json",
			},
			body: "[1,2]",
		});
		expect(notJson.status).toBe(400);
	});
});

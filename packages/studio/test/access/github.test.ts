import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import {
	createServer,
	type IncomingHttpHeaders,
	request,
	type Server,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	cookieValue,
	githubSignIn,
	SESSION_MAX_MS,
	SESSION_MS,
	writerOf,
} from "../../src/access/github.js";
import { failedLogins } from "../../src/access/login.js";
import { connectorRoutes } from "../../src/connector/routes.js";
import { findWrite, type WriteRoute } from "../../src/routes.js";

const DOMAIN = "factory.example.com";
const ORIGIN = `https://${DOMAIN}`;
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "v".repeat(50);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const servers: Server[] = [];
afterEach(() => {
	for (const s of servers.splice(0)) s.close();
});

interface Reply {
	status: number;
	text: string;
	headers: IncomingHttpHeaders;
}

/** A server of these routes, and a client that comes as the proxy does: Host is the domain. */
async function serve(
	routes: Record<string, WriteRoute>,
	extra?: (
		req: Parameters<WriteRoute>[0],
		res: Parameters<WriteRoute>[1],
	) => Promise<boolean>,
) {
	const server = createServer(async (req, res) => {
		if (extra && (await extra(req, res))) return;
		const route = findWrite(
			routes,
			req.method,
			new URL(req.url ?? "/", ORIGIN).pathname,
		);
		if (route) await route(req, res);
		else res.writeHead(404).end();
	});
	servers.push(server);
	await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
	const { port } = server.address() as AddressInfo;
	return (
		path: string,
		options: {
			method?: string;
			headers?: Record<string, string>;
			body?: string;
		} = {},
	) =>
		new Promise<Reply>((ok, ko) => {
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

/** GitHub as the sign-in sees it: the code's token, then the user. */
const fakeGitHub = (login = "octocat"): typeof fetch =>
	(async (input: string | URL | Request) => {
		const url = String(input);
		if (url === "https://github.com/login/oauth/access_token")
			return Response.json({ access_token: "gho_person" });
		if (url === "https://api.github.com/user") return Response.json({ login });
		return new Response(null, { status: 404 });
	}) as typeof fetch;

/** "name=value" of a Set-Cookie list. */
const cookieOf = (headers: IncomingHttpHeaders, name: string) =>
	(headers["set-cookie"] ?? [])
		.map((c) => c.split(";")[0] ?? "")
		.find((c) => c.startsWith(`${name}=`)) ?? "";

describe("writerOf", () => {
	const app = { token: async (repository: string) => `token-${repository}` };
	const answering = (answers: Record<string, Response | Error>): typeof fetch =>
		(async (input: string | URL | Request) => {
			const answer = answers[String(input).split("/")[5] ?? ""];
			if (answer instanceof Error) throw answer;
			return answer ?? new Response(null, { status: 404 });
		}) as typeof fetch;

	it("lets in who can write to one of the repositories, with the app's token of that repository", async () => {
		const asked: string[] = [];
		const fetchFn = (async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			asked.push(
				`${input} ${(init?.headers as Record<string, string> | undefined)?.Authorization}`,
			);
			return Response.json({
				permission: String(input).includes("/web/") ? "write" : "read",
			});
		}) as typeof fetch;
		expect(
			await writerOf(app, ["acme/api", "acme/web"], "octocat", fetchFn),
		).toBe(true);
		expect(asked).toEqual([
			"https://api.github.com/repos/acme/api/collaborators/octocat/permission Bearer token-acme/api",
			"https://api.github.com/repos/acme/web/collaborators/octocat/permission Bearer token-acme/web",
		]);
	});

	it("keeps out who only reads, and who is no collaborator", async () => {
		expect(
			await writerOf(
				app,
				["acme/api", "acme/web"],
				"octocat",
				answering({
					api: Response.json({ permission: "read" }),
					web: new Response(null, { status: 404 }),
				}),
			),
		).toBe(false);
	});

	it("throws when GitHub answered for no repository, rather than keeping everyone out in silence", async () => {
		await expect(
			writerOf(
				app,
				["acme/api"],
				"octocat",
				answering({ api: new Response(null, { status: 500 }) }),
			),
		).rejects.toThrow(/500/);
		// One answer is enough.
		expect(
			await writerOf(
				app,
				["acme/api", "acme/web"],
				"octocat",
				answering({
					api: new Error("offline"),
					web: Response.json({ permission: "admin" }),
				}),
			),
		).toBe(true);
	});
});

describe("githubSignIn", () => {
	const signIn = (
		options: {
			writer?: (login: string) => Promise<boolean>;
			now?: () => number;
			fetch?: typeof fetch;
		} = {},
	) =>
		githubSignIn({
			clientId: "Iv1.client",
			clientSecret: "client-secret",
			url: new URL(ORIGIN),
			writer: options.writer ?? (async () => true),
			now: options.now ?? (() => 1_000_000),
			fetch: options.fetch ?? fakeGitHub(),
		});

	/** To GitHub and back: the answer of the callback. */
	async function signInVia(
		github: ReturnType<typeof signIn>,
		to = "/",
		state?: (sent: string) => string,
	) {
		const call = await serve(github.routes);
		const out = await call(`/auth/github?to=${encodeURIComponent(to)}`);
		const sent =
			new URL(out.headers.location ?? "").searchParams.get("state") ?? "";
		return {
			out,
			back: await call(
				`/auth/github/callback?code=c1&state=${encodeURIComponent(state ? state(sent) : sent)}`,
				{
					headers: { cookie: cookieOf(out.headers, "openfabriq-github-state") },
				},
			),
		};
	}

	it("sends to GitHub with the app's client, the studio's callback and a state this browser keeps", async () => {
		const { out } = await signInVia(signIn());
		expect(out.status).toBe(302);
		const to = new URL(out.headers.location ?? "");
		expect(to.origin + to.pathname).toBe(
			"https://github.com/login/oauth/authorize",
		);
		expect(to.searchParams.get("client_id")).toBe("Iv1.client");
		expect(to.searchParams.get("redirect_uri")).toBe(
			`${ORIGIN}/auth/github/callback`,
		);
		const cookie = (out.headers["set-cookie"] ?? []).join();
		// Lax: GitHub sends the person back from its own site.
		expect(cookie).toMatch(
			/HttpOnly; Secure; SameSite=Lax; Path=\/auth\/github; Max-Age=600/,
		);
	});

	it("signs in a writer, then goes back where they were going", async () => {
		const { back } = await signInVia(signIn(), "/oauth/authorize?request=abc");
		expect(back.status).toBe(303);
		expect(back.headers.location).toBe("/oauth/authorize?request=abc");
		expect(cookieOf(back.headers, "openfabriq-session")).not.toBe("");
	});

	it("never goes back to another site", async () => {
		for (const to of [
			"//evil.example/",
			"/\\evil.example",
			"https://evil.example",
		]) {
			const { back } = await signInVia(signIn(), to);
			expect(back.headers.location, to).toBe("/");
		}
	});

	it("refuses a callback without this browser's state", async () => {
		const { back } = await signInVia(signIn(), "/", (sent) => `${sent}x`);
		expect(back.status).toBe(400);
		expect(cookieOf(back.headers, "openfabriq-session")).toBe("");
	});

	it("keeps out who cannot write to the factory's repositories, and says who they are", async () => {
		const { back } = await signInVia(signIn({ writer: async () => false }));
		expect(back.status).toBe(403);
		expect(back.text).toContain("octocat has no write access");
		expect(cookieOf(back.headers, "openfabriq-session")).toBe("");
	});

	it("says GitHub could not be asked, without its words in the page", async () => {
		const { back } = await signInVia(
			signIn({
				fetch: (async () =>
					Response.json({ error: "<b>bad</b>" })) as typeof fetch,
			}),
		);
		expect(back.status).toBe(502);
		expect(back.text).not.toContain("<b>");
	});

	it("knows the person for an hour, then asks GitHub again, and ends after a week", async () => {
		let now = 1_000_000;
		let writer = true;
		const asked: string[] = [];
		const github = signIn({
			now: () => now,
			writer: async (login) => {
				asked.push(login);
				return writer;
			},
		});
		const { back } = await signInVia(github);
		asked.length = 0;
		const cookie = cookieOf(back.headers, "openfabriq-session");
		const whoIs = async (cookieHeader = cookie) => {
			const call = await serve({}, async (req, res) => {
				const login = await github.session(req, res);
				res.writeHead(200).end(login ?? "");
				return true;
			});
			const reply = await call("/", { headers: { cookie: cookieHeader } });
			return {
				login: reply.text,
				renewed: cookieOf(reply.headers, "openfabriq-session"),
			};
		};
		expect(await whoIs()).toEqual({ login: "octocat", renewed: "" });
		expect(asked).toEqual([]);

		now += SESSION_MS;
		const renewed = await whoIs();
		expect(renewed.login).toBe("octocat");
		expect(renewed.renewed).not.toBe("");
		expect(asked).toEqual(["octocat"]);

		writer = false;
		now += SESSION_MS;
		expect((await whoIs(renewed.renewed)).login).toBe("");

		writer = true;
		asked.length = 0;
		now = 1_000_000 + SESSION_MAX_MS;
		expect((await whoIs(renewed.renewed)).login).toBe("");
		expect(asked).toEqual([]);
	});

	it("signs out when GitHub cannot say, and says why in the engine's log", async () => {
		let now = 1_000_000;
		const github = signIn({
			now: () => now,
			writer: async () => {
				throw new Error("GitHub answered 502 for acme/web");
			},
		});
		const { back } = await signInVia(github);
		now += SESSION_MS;
		const written: string[] = [];
		const spy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation((chunk) => {
				written.push(String(chunk));
				return true;
			});
		try {
			const call = await serve({}, async (req, res) => {
				res.writeHead(200).end((await github.session(req, res)) ?? "");
				return true;
			});
			const reply = await call("/", {
				headers: { cookie: cookieOf(back.headers, "openfabriq-session") },
			});
			expect(reply.text).toBe("");
			expect(await github.writer("octocat")).toBe(false);
		} finally {
			spy.mockRestore();
		}
		expect(written.join("")).toContain(
			"GitHub could not say whether octocat may still enter, so they are signed out: GitHub answered 502 for acme/web",
		);
	});

	it("knows no one from a cookie it did not sign", async () => {
		const other = githubSignIn({
			clientId: "Iv1.client",
			clientSecret: "another-secret",
			url: new URL(ORIGIN),
			writer: async () => true,
			fetch: fakeGitHub("mallory"),
		});
		const { back } = await signInVia(other);
		const github = signIn();
		const call = await serve({}, async (req, res) => {
			res.writeHead(200).end((await github.session(req, res)) ?? "");
			return true;
		});
		const reply = await call("/", {
			headers: { cookie: cookieOf(back.headers, "openfabriq-session") },
		});
		expect(reply.text).toBe("");
	});
});

it("reads one cookie among several", () => {
	const req = { headers: { cookie: "a=1; openfabriq-session=x.y; b=2" } };
	expect(cookieValue(req as never, "openfabriq-session")).toBe("x.y");
	expect(cookieValue(req as never, "c")).toBeUndefined();
});

describe("the connector with GitHub", () => {
	/** Signed in when the request says so; may still write while `writer` says so. */
	async function connector(writer = async (_login: string) => true) {
		const routes = connectorRoutes({
			url: new URL(ORIGIN),
			failures: failedLogins(),
			server: () => {
				throw new Error("no MCP call in these tests");
			},
			grantsPath: join(
				mkdtempSync(join(tmpdir(), "openfabriq-grants-")),
				"g.json",
			),
			github: {
				secret: "client-secret",
				session: async (req) =>
					req.headers.cookie === "signed=in" ? "octocat" : undefined,
				writer,
			},
		});
		return serve(routes);
	}
	const query = new URLSearchParams({
		response_type: "code",
		client_id: "client-1",
		redirect_uri: CALLBACK,
		code_challenge: CHALLENGE,
		code_challenge_method: "S256",
		state: "st",
	}).toString();
	const form = (fields: Record<string, string>) => ({
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			origin: ORIGIN,
		},
		body: new URLSearchParams(fields).toString(),
	});

	it("asks to sign in with GitHub first, then for the click, without a password", async () => {
		const call = await connector();
		const page = await call(`/oauth/authorize?${query}`);
		expect(page.status).toBe(200);
		expect(page.text).not.toContain('name="password"');
		const link = /href="(\/auth\/github\?to=[^"]+)"/.exec(page.text)?.[1] ?? "";
		const back = new URL(link, ORIGIN).searchParams.get("to") ?? "";
		expect(back).toMatch(/^\/oauth\/authorize\?request=/);

		const signedIn = await call(back, { headers: { cookie: "signed=in" } });
		expect(signedIn.text).toContain("You are signed in as octocat.");
		expect(signedIn.text).toContain('<button type="submit">Allow</button>');
		expect(signedIn.text).not.toContain('name="password"');
	});

	it("gives Claude a code for who is signed in, and refuses a click from no one", async () => {
		const call = await connector();
		const page = await call(`/oauth/authorize?${query}`);
		const request = /request%3D([^"&]+)"/.exec(page.text)?.[1] ?? "";
		const nobody = await call("/oauth/authorize", form({ request }));
		expect(nobody.status).toBe(401);
		const allowed = await call("/oauth/authorize", {
			...form({ request }),
			headers: { ...form({ request }).headers, cookie: "signed=in" },
		});
		expect(allowed.status).toBe(303);
		expect(new URL(allowed.headers.location ?? "").origin).toBe(
			"https://claude.ai",
		);
	});

	it("stops renewing Claude's access once the person lost theirs on GitHub", async () => {
		let writer = true;
		const call = await connector(async () => writer);
		const page = await call(`/oauth/authorize?${query}`);
		const request = /request%3D([^"&]+)"/.exec(page.text)?.[1] ?? "";
		const allowed = await call("/oauth/authorize", {
			...form({ request }),
			headers: { ...form({ request }).headers, cookie: "signed=in" },
		});
		const code =
			new URL(allowed.headers.location ?? "").searchParams.get("code") ?? "";
		const token = (fields: Record<string, string>) =>
			call("/oauth/token", {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams(fields).toString(),
			}).then((r) => ({ status: r.status, body: JSON.parse(r.text) }));
		const first = await token({
			grant_type: "authorization_code",
			code,
			code_verifier: VERIFIER,
			redirect_uri: CALLBACK,
			client_id: "client-1",
		});
		expect(first.status).toBe(200);
		const renewed = await token({
			grant_type: "refresh_token",
			refresh_token: first.body.refresh_token,
		});
		expect(renewed.status).toBe(200);
		writer = false;
		const refused = await token({
			grant_type: "refresh_token",
			refresh_token: renewed.body.refresh_token,
		});
		expect(refused.status).toBe(400);
		expect(refused.body.error).toBe("invalid_grant");
	});
});

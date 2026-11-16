import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { type IncomingHttpHeaders, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	appendRun,
	projectDir,
	readFactoryFolder,
	studioTokenPath,
	writeApplied,
} from "@openfabriq/runner";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cookieName } from "../src/access/session.js";
import { startStudio } from "../src/server.js";

const REPO = "acme/task-app";
const temp = (name: string) => mkdtempSync(join(tmpdir(), name));
let server: ReturnType<typeof startStudio>;
let app: string;
let base: string;
let cookie: string;
let name: string;
const PR = "https://github.com/acme/task-app/pull/7";
const asked: string[] = [];

beforeAll(async () => {
	process.env.OPENFABRIQ_HOME = temp("openfabriq-home-");
	const files = readFactoryFolder(
		join(import.meta.dirname, "../../../fixtures/valid/sdlc/openfabriq"),
	);
	files["factory.yaml"] +=
		"commands:\n  test: npm test\n  lint: npm run lint\nchecks: [test]\ntimezone: Europe/Paris\n";
	files["automations/nightly/automation.md"] =
		'---\nwhen:\n  schedule: { cron: "0 2 * * *" }\nagent: implementer\nconcurrency: repository\n---\nImprove the code.\n';
	writeApplied(REPO, files);
	appendRun({
		id: "run-1",
		repository: REPO,
		automation: "implement-ready-issues",
		agent: "implementer",
		event: "issue.labeled",
		number: 4,
		isPullRequest: false,
		status: "succeeded",
		queuedAt: new Date().toISOString(),
		durationMs: 1000,
		costUsd: 0.5,
		outputs: [
			{
				action: "create_pull_request",
				summary: "Add a counter",
				status: "applied",
				url: PR,
			},
		],
	});
	writeFileSync(
		join(projectDir(REPO), "chats.jsonl"),
		`${JSON.stringify({ at: new Date().toISOString(), sessionId: "s", costUsd: 0.25, durationMs: 5 })}\n`,
	);
	const runDir = join(projectDir(REPO), "runs", "run-1");
	mkdirSync(runDir, { recursive: true });
	writeFileSync(join(runDir, "prompt.md"), "Implement issue #4.");
	writeFileSync(
		join(runDir, "commands.jsonl"),
		`${JSON.stringify({ kind: "check", name: "test", command: "npm test", ok: true, output: "ok", durationMs: 900, at: "2026-11-03T02:00:00Z" })}\n{"kind":"command","na`, // a line still being written
	);
	writeFileSync(
		join(runDir, "transcript.jsonl"),
		readFileSync(join(import.meta.dirname, "fixtures/transcript.jsonl")),
	);
	const parent = temp("openfabriq-app-");
	app = join(parent, "app");
	mkdirSync(app);
	// Files next to the app's folder, to prove the server never reaches them.
	writeFileSync(join(parent, "secret.txt"), "secret");
	mkdirSync(join(parent, "app-other"));
	writeFileSync(join(parent, "app-other", "secret.txt"), "secret");
	writeFileSync(join(app, "index.html"), "<!doctype html><title>app</title>");
	mkdirSync(join(app, "assets"));
	writeFileSync(join(app, "assets", "main.js"), "console.log(1)");
	server = startStudio(0, app, {
		subjectState: async (url) => {
			asked.push(url);
			return { merged: true, open: false };
		},
	});
	await new Promise((ok) => server.once("listening", ok));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	name = cookieName((server.address() as AddressInfo).port);
	cookie = `${name}=${readFileSync(studioTokenPath(), "utf8")}`;
});
afterAll(() => {
	server.close();
});

/** fetch with the cookie that the address printed by `start` sets. */
const signed = (url: string, init: RequestInit = {}) =>
	fetch(url, { ...init, headers: { cookie, ...init.headers } });

/** Sends the path and the headers exactly as written, unlike fetch, with the cookie unless replaced. */
function raw(
	path: string,
	headers: Record<string, string> = {},
	options: { method?: string; body?: string; to?: typeof server } = {},
): Promise<{ status: number; text: string; headers: IncomingHttpHeaders }> {
	const { port } = (options.to ?? server).address() as AddressInfo;
	return new Promise((ok, ko) => {
		const req = request(
			{
				host: "127.0.0.1",
				port,
				path,
				method: options.method ?? "GET",
				headers: { host: `127.0.0.1:${port}`, cookie, ...headers },
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

it("answers only requests that name this server as Host", async () => {
	const { port } = server.address() as AddressInfo;
	for (const host of ["evil.example", `evil.example:${port}`, "127.0.0.1:1"])
		for (const path of ["/", "/api/projects", "/api/runs"])
			expect((await raw(path, { host })).status, `${host} ${path}`).toBe(403);
	// The Vite dev proxy rewrites Host to its target (changeOrigin).
	expect(
		(await raw("/api/projects", { host: `localhost:${port}` })).status,
	).toBe(200);
});

it("serves no data and no token without the cookie", async () => {
	const token = cookie.slice(`${name}=`.length);
	for (const headers of [
		{ cookie: "" },
		{ cookie: `${name}=${"0".repeat(64)}` },
		{ cookie: `${name}=` },
		// Another studio's cookie, on another port of the same machine.
		{ cookie: `${cookieName(1)}=${token}` },
		{ cookie: `other=${token}` },
	]) {
		for (const path of [
			"/api/projects",
			"/api/runs",
			`/api/run?id=run-1`,
			`/api/chats?project=${REPO}`,
			"/api/metrics",
		]) {
			const res = await raw(path, headers);
			expect(res.status, `${headers.cookie} ${path}`).toBe(401);
			expect(JSON.parse(res.text).error).toContain("openfabriq start");
		}
		const page = await raw("/", headers);
		expect(page.status).toBe(401);
		expect(page.text).toContain("openfabriq start");
		expect(page.text).not.toContain(token);
		expect((await raw("/index.html", headers)).status).toBe(401);
		// The app's scripts hold no data.
		expect((await raw("/assets/main.js", headers)).status).toBe(200);
	}
	expect((await raw("/", { cookie: `a=b; ${cookie}; c=d` })).status).toBe(200);
});

it("turns the token of the printed address into a cookie, and takes it out of the address", async () => {
	const token = cookie.slice(`${name}=`.length);
	const res = await signed(`${base}/?token=${token}`, {
		headers: { cookie: "" },
		redirect: "manual",
	});
	expect(res.status).toBe(303);
	expect(res.headers.get("location")).toBe("/");
	expect(res.headers.get("set-cookie")).toBe(
		`${name}=${token}; HttpOnly; SameSite=Strict; Path=/`,
	);
	// Never an address on another host, which `//host/` would be.
	const deep = await raw(`/x/..//evil.example/?project=a&token=${token}`);
	expect(deep.headers.location).toBe("/evil.example/?project=a");
	for (const wrong of ["", "0".repeat(64), `${token}0`]) {
		const refused = await raw(`/?token=${wrong}`, { cookie: "" });
		expect(refused.status, wrong).toBe(401);
		expect(refused.headers["set-cookie"]).toBeUndefined();
	}
});

it("forbids every other site to show it in a frame", async () => {
	for (const [path, headers] of [
		["/", {}],
		["/api/projects", {}],
		["/api/projects", { cookie: "" }],
		["/assets/main.js", {}],
		["/api/projects", { host: "evil.example" }],
		["/%", {}],
	] as const) {
		const { headers: sent } = await raw(path, headers);
		expect(sent["x-frame-options"], path).toBe("DENY");
		expect(sent["content-security-policy"], path).toBe(
			"frame-ancestors 'none'",
		);
	}
});

it("never serves a file next to the app's folder, however the path is encoded", async () => {
	for (const path of [
		"/..%2fsecret.txt",
		"/%2e%2e%2fsecret.txt",
		"/..%2F..%2Fsecret.txt",
		"/..%2fapp-other%2fsecret.txt",
		"/assets/..%2f..%2fsecret.txt",
	]) {
		const res = await raw(path);
		expect(res.status, path).toBe(404);
		expect(res.text).not.toContain("secret");
	}
});

it("answers 404 for a project it does not know, never every project's data", async () => {
	for (const route of [
		"runs",
		"board",
		"metrics",
		"agents",
		"workflow",
		"settings",
		"chats",
	])
		expect(
			(await raw(`/api/${route}?project=someone/else`)).status,
			route,
		).toBe(404);
});

it("answers a request it cannot read with an error, and keeps answering", async () => {
	expect((await raw("/%")).status).toBe(400);
	const chats = join(projectDir(REPO), "chats");
	const broken = "3f0c1d2e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";
	mkdirSync(chats, { recursive: true });
	writeFileSync(join(chats, `${broken}.json`), "{ cut");
	expect((await raw(`/api/chats/${broken}?project=${REPO}`)).status).toBe(500);
	expect((await raw("/api/projects")).status).toBe(200);
});

it("serves the conversations of the only project without asking which", async () => {
	expect(await (await signed(`${base}/api/chats`)).json()).toEqual(
		await (await signed(`${base}/api/chats?project=${REPO}`)).json(),
	);
	expect((await raw("/api/chats/none")).status).toBe(404);
});

it("serves the workflow graph of the applied factory", async () => {
	const res = await signed(`${base}/api/workflow?project=${REPO}`);
	const body = (await res.json()) as {
		name: string;
		graph: { nodes: { id: string }[] };
	};
	expect(res.status).toBe(200);
	expect(body.name).toBe("Task app factory");
	expect(body.graph.nodes.map((n) => n.id)).toContain(
		"automation:implement-ready-issues",
	);
	expect(await (await signed(`${base}/api/projects`)).json()).toEqual([REPO]);
});

it("serves the factory's settings, never the studio's token", async () => {
	const res = await signed(`${base}/api/settings?project=${REPO}`);
	const text = await res.text();
	expect(res.status).toBe(200);
	expect(JSON.parse(text)).toMatchObject({
		name: "Task app factory",
		commands: { test: "npm test", lint: "npm run lint" },
		checks: ["test"],
		timezone: "Europe/Paris",
		ready: { secrets: {}, relay: false },
	});
	expect(text).not.toContain(cookie.split("=")[1]);
});

it("serves the app's files and nothing outside them", async () => {
	expect(await (await signed(`${base}/`)).text()).toContain("<title>app");
	const js = await signed(`${base}/assets/main.js`);
	expect(js.headers.get("content-type")).toContain("text/javascript");
	for (const path of ["/../package.json", "/%2e%2e/%2e%2e/package.json"])
		expect((await signed(`${base}${path}`)).status).toBe(404);
	expect((await signed(`${base}/api/run`, { method: "POST" })).status).toBe(
		405,
	);
});

it("serves a run with its prompt and its conversation", async () => {
	const body = (await (await signed(`${base}/api/run?id=run-1`)).json()) as {
		prompt: string;
		commands: { kind: string; name: string; ok: boolean }[];
		transcript: { messages: { role: string }[] };
		story: { effects: unknown[]; followers: unknown[][] };
	};
	expect(body.prompt).toBe("Implement issue #4.");
	expect(body.commands).toMatchObject([
		{ kind: "check", name: "test", ok: true },
	]);
	expect(body.transcript.messages.map((m) => m.role)).toEqual(["assistant"]);
	expect(body.story).toEqual({
		effects: [],
		followers: [[{ automation: "review-pull-requests", agent: "reviewer" }]],
	});
});

it("serves the agents of a project with the automations that use them", async () => {
	const body = (await (
		await signed(`${base}/api/agents?project=${REPO}`)
	).json()) as {
		timezone: string;
		agents: {
			name: string;
			automations: {
				name: string;
				schedules?: { cron: string; words: string; next: string }[];
			}[];
		}[];
		commands: Record<string, string>;
		checks: string[];
	};
	// The factory's harness, for the agents' pages.
	expect(body.commands).toEqual({
		test: "npm test",
		lint: "npm run lint",
	});
	expect(body.checks).toEqual(["test"]);
	const implementer = body.agents.find((a) => a.name === "implementer");
	expect(implementer?.automations.map((a) => a.name)).toContain(
		"implement-ready-issues",
	);
	// A schedule in words, and its next run in the factory's time zone.
	const nightly = implementer?.automations.find((a) => a.name === "nightly");
	expect(body.timezone).toBe("Europe/Paris");
	expect(nightly?.schedules).toEqual([
		{
			cron: "0 2 * * *",
			words: "every day at 02:00",
			next: expect.any(String),
		},
	]);
	const next = new Date(nightly?.schedules?.[0]?.next ?? "");
	expect(next.toLocaleTimeString("en-GB", { timeZone: "Europe/Paris" })).toBe(
		"02:00:00",
	);
});

it("serves the metrics of each project, asking gh once per pull request", async () => {
	const get = async () =>
		(await (await signed(`${base}/api/metrics?period=30d`)).json()) as {
			repository: string;
			metrics: {
				pullRequests: { opened: number; merged: number };
				cost: { chatUsd: number };
			};
		}[];
	const [project] = await get();
	expect(project?.metrics.cost.chatUsd).toBe(0.25);
	expect(project?.repository).toBe(REPO);
	expect(project?.metrics.pullRequests).toEqual({
		opened: 1,
		merged: 1,
		closed: 0,
		unknown: 0,
	});
	await get();
	expect(asked).toEqual([PR]);
	expect((await signed(`${base}/api/metrics?period=1y`)).status).toBe(400);
});

it("says so when its port is taken, and keeps the process alive", async () => {
	const { port } = server.address() as AddressInfo;
	const written: string[] = [];
	const spy = vi.spyOn(process.stderr, "write").mockImplementation((line) => {
		written.push(String(line));
		return true;
	});
	const second = startStudio(port, temp("openfabriq-app-"));
	try {
		await new Promise((ok) => setTimeout(ok, 50));
	} finally {
		spy.mockRestore();
		second.close();
	}
	expect(written.join("")).toContain(`127.0.0.1:${port}`);
	expect(written.join("")).toContain("EADDRINUSE");
	expect((await raw("/api/projects")).status).toBe(200);
});

it("says on stderr why a write could not answer, and closes it", async () => {
	const written: string[] = [];
	const spy = vi.spyOn(process.stderr, "write").mockImplementation((line) => {
		written.push(String(line));
		return true;
	});
	try {
		// The page leaves in the middle of its message: reading the body fails.
		const sent = request(`${base}/api/chat`, {
			method: "POST",
			headers: {
				cookie,
				host: new URL(base).host,
				"content-type": "application/json",
				"content-length": "1000",
			},
		});
		sent.on("error", () => {});
		sent.write('{"project":');
		await new Promise((ok) => setTimeout(ok, 50));
		sent.destroy();
		await new Promise((ok) => setTimeout(ok, 100));
	} finally {
		spy.mockRestore();
	}
	expect(written.join("")).toContain(
		"the studio could not answer POST /api/chat",
	);
	expect((await raw("/api/projects")).status).toBe(200);
});

it("has no sign-in route without a password", async () => {
	const res = await raw(
		"/login",
		{
			cookie: "",
			"content-type": "application/x-www-form-urlencoded",
		},
		{ method: "POST", body: "password=anything" },
	);
	expect(res.status).toBe(405);
	expect(res.headers["set-cookie"]).toBeUndefined();
	expect(
		(await raw("/", { cookie: "", host: "factory.example.com" })).status,
	).toBe(403);
});

describe("with OPENFABRIQ_STUDIO_PASSWORD and OPENFABRIQ_STUDIO_URL", () => {
	const PASSWORD = "correct horse battery staple";
	const DOMAIN = "factory.example.com";
	const FORM = "application/x-www-form-urlencoded";
	let studio: typeof server;
	const to = () => studio;
	const login = (password: string, headers: Record<string, string> = {}) =>
		raw(
			"/login",
			{ cookie: "", host: DOMAIN, "content-type": FORM, ...headers },
			{
				method: "POST",
				body: new URLSearchParams({ password }).toString(),
				to: to(),
			},
		);

	beforeAll(async () => {
		studio = startStudio(0, app, {
			access: {
				password: PASSWORD,
				url: new URL(`https://${DOMAIN}`),
			},
		});
		await new Promise((ok) => studio.once("listening", ok));
	});
	afterAll(() => {
		studio.close();
	});

	it("shows a sign-in form, and no data, without the cookie", async () => {
		for (const host of [DOMAIN, undefined]) {
			const headers = { cookie: "", ...(host ? { host } : {}) };
			const page = await raw("/", headers, { to: to() });
			expect(page.status).toBe(401);
			expect(page.headers["content-type"]).toContain("text/html");
			expect(page.text).toContain('<form method="post" action="/login">');
			expect(page.text).toContain('type="password"');
			expect(page.text).not.toContain(PASSWORD);
			expect((await raw("/api/projects", headers, { to: to() })).status).toBe(
				401,
			);
		}
		expect(
			(await raw("/", { host: "evil.example" }, { to: to() })).status,
		).toBe(403);
	});

	it("turns the right password into the cookie, Secure on the studio's address", async () => {
		const res = await login(PASSWORD, { origin: `https://${DOMAIN}` });
		expect(res.status).toBe(303);
		expect(res.headers.location).toBe("/");
		const set = res.headers["set-cookie"]?.[0] ?? "";
		expect(set).toMatch(
			/^openfabriq-\d+=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\/; Secure$/,
		);
		const session = set.split(";")[0] ?? "";
		const projects = await raw(
			"/api/projects",
			{ host: DOMAIN, cookie: session },
			{ to: to() },
		);
		expect(projects.status).toBe(200);
		expect(JSON.parse(projects.text)).toEqual([REPO]);
		// Through the tunnel, plain http: no Secure, or the browser would drop it.
		const local = await login(PASSWORD, {
			host: `127.0.0.1:${(studio.address() as AddressInfo).port}`,
		});
		expect(local.status).toBe(303);
		expect(local.headers["set-cookie"]?.[0]).not.toContain("Secure");
	});

	it("still takes the token of the printed address", async () => {
		const token = readFileSync(studioTokenPath(), "utf8");
		const res = await raw(
			`/?token=${token}`,
			{ cookie: "", host: DOMAIN },
			{ to: to() },
		);
		expect(res.status).toBe(303);
		expect(res.headers["set-cookie"]?.[0]).toContain("; Secure");
	});

	it("says the app may sign out, and signs out from its own page only", async () => {
		const res = await login(PASSWORD, { origin: `https://${DOMAIN}` });
		const cookie = (res.headers["set-cookie"]?.[0] ?? "").split(";")[0] ?? "";
		const me = await raw("/api/me", { host: DOMAIN, cookie }, { to: to() });
		expect(JSON.parse(me.text)).toEqual({ signOut: true });
		const out = (origin: string) =>
			raw(
				"/logout",
				{ host: DOMAIN, cookie, origin },
				{ method: "POST", to: to() },
			);
		expect((await out("https://evil.example")).status).toBe(403);
		const signedOut = await out(`https://${DOMAIN}`);
		expect(signedOut.status).toBe(303);
		expect(signedOut.headers["set-cookie"]?.[0]).toMatch(
			/^openfabriq-\d+=; .*Max-Age=0$/,
		);
	});

	it("accepts the chat's writes from the studio's origin only", async () => {
		const token = readFileSync(studioTokenPath(), "utf8");
		const write = (origin: string) =>
			raw(
				"/api/chat",
				{
					host: DOMAIN,
					origin,
					cookie: `${cookieName((studio.address() as AddressInfo).port)}=${token}`,
					"content-type": "application/json",
				},
				{ method: "POST", body: "{}", to: to() },
			);
		expect((await write(`https://${DOMAIN}`)).status).toBe(400);
		expect((await write(`http://${DOMAIN}`)).status).toBe(403);
		expect((await write("https://evil.example")).status).toBe(403);
	});

	it("refuses a wrong password, another site's form and a body that is not a form", async () => {
		const wrong = await login("not the password at all");
		expect(wrong.status).toBe(401);
		expect(wrong.text).toContain("Wrong password");
		expect(wrong.headers["set-cookie"]).toBeUndefined();
		expect(
			(await login(PASSWORD, { origin: "https://evil.example" })).status,
		).toBe(403);
		const json = await raw(
			"/login",
			{ cookie: "", host: DOMAIN, "content-type": "application/json" },
			{
				method: "POST",
				body: JSON.stringify({ password: PASSWORD }),
				to: to(),
			},
		);
		expect(json.status).toBe(415);
		const big = await raw(
			"/login",
			{ cookie: "", host: DOMAIN, "content-type": FORM },
			{ method: "POST", body: `password=${"a".repeat(5000)}`, to: to() },
		);
		expect(big.status).toBe(413);
	});

	// Last: it locks sign-in for this server.
	it("stops taking passwords after 10 failures, even the right one", async () => {
		for (let i = 0; i < 10; i++) await login(`wrong password number ${i}`);
		const res = await login(PASSWORD);
		expect(res.status).toBe(429);
		expect(res.headers["set-cookie"]).toBeUndefined();
	});
});

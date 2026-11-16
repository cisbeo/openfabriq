import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { type RelayEvent, relayClient } from "@openfabriq/runner";
import { afterAll, beforeAll, expect, it } from "vitest";
import { freshHome, writeSecrets } from "../support/home.js";
import { freePort, type LocalRelay, startRelay } from "../support/relay.js";
import { linearRequest, slackRequest } from "../support/sign.js";
import { fakeCommands, session } from "../support/terminal.js";

// "openfabriq connect" for each service, as a person runs it in a terminal: the built CLI, the
// real relay (wrangler dev), and Sentry, Slack and Linear faked over HTTP. What the CLI gives the
// relay is checked by what the relay then does, never by reading its storage.

const SENTRY_TOKEN = "sntryu_e2e_full";
const SENTRY_READ_ONLY = "sntryu_e2e_read_only";
const SLACK_SIGNING = "slack-signing-e2e";
const LINEAR_SECRET = "linear-webhook-e2e";
const ENTER = "\r";
const CTRL_C = "\u0003";
const BACKSPACE = "\u007f";

let relay: LocalRelay;
let home: string;
let api: FakeServices;
const commands = fakeCommands();

beforeAll(async () => {
	relay = await startRelay();
	home = freshHome();
	writeSecrets(home, { relay: { url: relay.url, token: relay.token } });
	api = await fakeServices();
});
afterAll(async () => {
	api?.server.close();
	await relay?.stop();
});

const secrets = () =>
	JSON.parse(readFileSync(join(home, "secrets.json"), "utf8")) as Record<
		string,
		Record<string, string> | undefined
	>;
const connect = (service: string, terminal = true) =>
	session(["connect", service], {
		terminal,
		path: commands.dir,
		env: { E2E_FAKE_API: api.url },
	});

interface FakeServices {
	url: string;
	server: Server;
	/** Each request: method, path and Authorization header. */
	requests: string[];
	/** What Sentry's issue search answers. */
	sentryIssues: unknown[];
}

/** Sentry at its own address (the CLI asks for it), Slack under /slack/ and Linear under /linear/. */
async function fakeServices(): Promise<FakeServices> {
	const fake: FakeServices = {
		url: "",
		server: createServer(async (request, response) => {
			const path = new URL(request.url ?? "/", "http://fake").pathname;
			const auth = request.headers.authorization ?? "";
			fake.requests.push(`${request.method} ${path} ${auth}`);
			for await (const _ of request);
			const json = (data: unknown, status = 200) => {
				response.writeHead(status, { "content-type": "application/json" });
				response.end(JSON.stringify(data));
			};
			const scopes: Record<string, string[]> = {
				[`Bearer ${SENTRY_TOKEN}`]: [
					"project:read",
					"event:read",
					"event:write",
				],
				[`Bearer ${SENTRY_READ_ONLY}`]: ["project:read", "event:read"],
			};
			if (path === "/api/0/")
				return scopes[auth]
					? json({
							auth: { scopes: scopes[auth] },
							user: { username: "alice" },
						})
					: json({ detail: "Invalid token" }, 401);
			if (auth !== `Bearer ${SENTRY_TOKEN}` && path.startsWith("/api/0/"))
				return json({ detail: "Invalid token" }, 401);
			if (path === "/api/0/projects/acme/web/") return json({ id: "42" });
			if (path === "/api/0/organizations/acme/issues/")
				return json(fake.sentryIssues);
			if (path === "/slack/auth.test")
				return json(
					auth === "Bearer xoxb-e2e"
						? { ok: true, user: "openfabriq", team: "Acme" }
						: { ok: false, error: "invalid_auth" },
				);
			json({ error: "not faked" }, 404);
		}),
		requests: [],
		sentryIssues: [],
	};
	const port = await freePort();
	await new Promise<void>((resolve) =>
		fake.server.listen(port, "127.0.0.1", resolve),
	);
	fake.url = `http://127.0.0.1:${port}`;
	return fake;
}

it("connect sentry: Ctrl-C at a question stops it, and nothing is saved", async () => {
	const cli = connect("sentry");
	await cli.waitFor("Sentry URL");
	cli.type(ENTER);
	await cli.waitFor("Auth token");
	cli.type(CTRL_C);
	const { code, output } = await cli.done();
	expect(code).toBe(130);
	expect(output).toContain("Cancelled.");
	expect(secrets().sentry).toBeUndefined();
});

it("connect sentry, in a pipe: a token without event:write is refused, and nothing is saved", async () => {
	const cli = connect("sentry", false);
	await cli.waitFor("Sentry URL");
	cli.type(`${api.url}\n`);
	await cli.waitFor("Auth token");
	cli.type(`${SENTRY_READ_ONLY}\n`);
	const { code, output } = await cli.done();
	expect(output).toContain("The token lacks event:write. Nothing was saved.");
	expect(code).toBe(1);
	expect(secrets().sentry).toBeUndefined();
});

it("connect sentry, in a terminal: the token is tested, hidden, kept here, and the relay finds new issues with it", async () => {
	const cli = connect("sentry");
	await cli.waitFor("Sentry URL");
	// The default address is typed in, ready to keep or edit: replaced by the fake Sentry's.
	await cli.waitFor("https://sentry.io");
	cli.type(`${BACKSPACE.repeat(30)}${api.url}${ENTER}`);
	await cli.waitFor("Auth token");
	cli.type(`${SENTRY_TOKEN}${ENTER}`);
	const { code, output } = await cli.done();
	expect(output).toContain(`Sentry connected as alice on ${api.url}`);
	expect(code).toBe(0);
	expect(output).not.toContain(SENTRY_TOKEN);
	expect(secrets().sentry).toEqual({ token: SENTRY_TOKEN, url: api.url });

	// What "openfabriq start" tells the relay: then the relay searches Sentry within a minute.
	api.sentryIssues = [
		{
			id: "1001",
			shortId: "WEB-1",
			permalink: `${api.url}/organizations/acme/issues/1001/`,
			firstSeen: new Date().toISOString(),
		},
	];
	const client = relayClient({ url: relay.url, token: relay.token });
	await client.watchSentry([{ organization: "acme", project: "web" }]);
	const issue = await new Promise<RelayEvent>((resolve) =>
		client.listen(
			async (events) => {
				const found = events.find(
					(e) => e.service === "sentry" && e.kind === "issue",
				);
				if (found) resolve(found);
				return found ? [found.id] : [];
			},
			() => undefined,
		),
	);
	client.stop();
	expect(issue).toMatchObject({
		organization: "acme",
		project: "web",
		issue: { shortId: "WEB-1" },
	});
	expect(api.requests).toContain(
		`GET /api/0/organizations/acme/issues/ Bearer ${SENTRY_TOKEN}`,
	);
}, 120_000);

it("connect slack: the manifest copied, the signing secret given to the relay, the bot token tested and kept here", async () => {
	const cli = connect("slack");
	await cli.waitFor("Copy the manifest");
	cli.type(ENTER);
	await cli.waitFor("Press Enter once the app is created");
	expect(commands.calls()).toContain(`request_url: ${relay.url}/hooks/slack`);
	cli.type(ENTER);
	await cli.waitFor("Signing secret");
	cli.type(`${SLACK_SIGNING}${ENTER}`);
	await cli.waitFor("Bot token");
	cli.type(`xoxb-e2e${ENTER}`);
	const { code, output } = await cli.done();
	expect(output).toContain("Slack connected: @openfabriq in Acme");
	expect(code).toBe(0);
	expect(output).not.toContain(SLACK_SIGNING);
	expect(secrets().slack).toEqual({ bot_token: "xoxb-e2e" });

	// The relay answers Slack's URL check signed with that secret, and only with it.
	const check = JSON.stringify({ type: "url_verification", challenge: "c-7" });
	const send = (secret: string) =>
		fetch(`${relay.url}/hooks/slack`, {
			method: "POST",
			body: check,
			headers: slackRequest(secret, check),
		});
	const answer = await send(SLACK_SIGNING);
	expect(await answer.text()).toBe("c-7");
	expect((await send("another-secret")).status).toBe(401);
});

it("connect slack: a bot token Slack refuses is not saved", async () => {
	const cli = connect("slack");
	await cli.waitFor("Copy the manifest");
	cli.type(`n${ENTER}`);
	await cli.waitFor("Press Enter once the app is created");
	cli.type(ENTER);
	await cli.waitFor("Signing secret");
	cli.type(`${SLACK_SIGNING}${ENTER}`);
	await cli.waitFor("Bot token");
	cli.type(`xoxb-revoked${ENTER}`);
	const { code, output } = await cli.done();
	expect(output).toContain(
		"The bot token does not work (Slack auth.test: invalid_auth)",
	);
	expect(code).toBe(1);
	expect(secrets().slack).toEqual({ bot_token: "xoxb-e2e" });
});

it("connect linear: the app's secrets given to the relay, and Linear's install page opened", async () => {
	const cli = connect("linear");
	await cli.waitFor("Client ID");
	cli.type(`cid-e2e${ENTER}`);
	await cli.waitFor("Client secret");
	cli.type(`csecret-e2e${ENTER}`);
	await cli.waitFor("Webhook signing secret");
	cli.type(`${LINEAR_SECRET}${ENTER}`);
	await cli.waitFor("Waiting up to 5 minutes");
	// shortcut: the install itself is not run; the relay trades Linear's code for a token at
	// api.linear.app from inside the Worker, which this test cannot fake. Checked by hand.
	const openedPage = () => /^(?:xdg-)?open (\S+)$/m.exec(commands.calls())?.[1];
	for (let i = 0; i < 100 && !openedPage(); i++)
		await new Promise((r) => setTimeout(r, 50));
	cli.stop();
	const opened = openedPage() ?? "";
	const authorize = new URL(opened);
	expect(authorize.origin + authorize.pathname).toBe(
		"https://linear.app/oauth/authorize",
	);
	expect(authorize.searchParams.get("client_id")).toBe("cid-e2e");
	expect(authorize.searchParams.get("redirect_uri")).toBe(
		`${relay.url}/oauth/linear/callback`,
	);

	// The relay checks Linear's webhooks with that signing secret, and only with it.
	const body = JSON.stringify({
		action: "create",
		type: "Comment",
		organizationId: "org-1",
		webhookTimestamp: Date.now(),
		data: { id: "c1" },
	});
	const send = (secret: string) =>
		fetch(`${relay.url}/hooks/linear`, {
			method: "POST",
			body,
			headers: linearRequest(secret, `d-${Math.random()}`, body),
		});
	expect((await send(LINEAR_SECRET)).status).toBe(200);
	expect((await send("another-secret")).status).toBe(401);
});

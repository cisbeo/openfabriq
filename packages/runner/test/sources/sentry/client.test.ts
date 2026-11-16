import { expect, it } from "vitest";
import {
	issueContext,
	sentryClient,
	stackTrace,
} from "../../../src/sources/sentry/client.js";

const event: Parameters<typeof stackTrace>[0] = {
	dateCreated: "2026-11-02T10:00:05Z",
	release: { version: "web@1.4.2" },
	tags: [
		{ key: "environment", value: "production" },
		{ key: "release", value: "web@1.4.2" },
	],
	entries: [
		{ type: "breadcrumbs", data: { values: [] } },
		{
			type: "exception",
			data: {
				values: [
					{
						type: "TypeError",
						value: "Cannot read properties of undefined (reading 'trim')",
						stacktrace: {
							frames: [
								{
									filename: "node_modules/react-dom/index.js",
									function: "render",
									lineNo: 10,
									inApp: false,
								},
								{
									filename: "src/tasks.ts",
									function: "addTask",
									lineNo: 42,
									colNo: 7,
									inApp: true,
									context: [
										[41, "export function addTask(title) {"],
										[42, "  return title.trim();"],
									],
									// @ts-expect-error Sentry sends local variables; the engine must never forward them
									vars: { title: "alice@example.com" },
								},
							],
						},
					},
				],
			},
		},
	],
};

it("writes the stack trace innermost frame first, without frame variables", () => {
	const text = stackTrace(event);
	expect(text).toBe(
		[
			"TypeError: Cannot read properties of undefined (reading 'trim')",
			"  at addTask (src/tasks.ts:42:7)",
			"      return title.trim();",
			"  at render (node_modules/react-dom/index.js:10) [library]",
		].join("\n"),
	);
	expect(text).not.toContain("alice@example.com");
	expect(stackTrace(event, 20)).toBe(
		"TypeError: Cannot re\n… (cut at 20 characters)",
	);
});

it("gives the agent the issue's summary, environment, release and stack trace", () => {
	expect(
		issueContext(
			{
				shortId: "WEB-APP-12",
				title: "TypeError: Cannot read properties of undefined",
				culprit: "addTask(src/tasks)",
				level: "error",
				status: "unresolved",
				count: "57",
				userCount: 12,
				firstSeen: "2026-11-02T10:00:01Z",
				lastSeen: "2026-11-02T10:00:05Z",
				permalink: "https://acme.sentry.io/issues/123/",
				metadata: { filename: "secret" },
			},
			event,
		),
	).toEqual({
		short_id: "WEB-APP-12",
		title: "TypeError: Cannot read properties of undefined",
		culprit: "addTask(src/tasks)",
		level: "error",
		status: "unresolved",
		events: "57",
		users: 12,
		first_seen: "2026-11-02T10:00:01Z",
		last_seen: "2026-11-02T10:00:05Z",
		environment: "production",
		release: "web@1.4.2",
		url: "https://acme.sentry.io/issues/123/",
		latest_event_at: "2026-11-02T10:00:05Z",
		stack_trace: expect.stringContaining("at addTask (src/tasks.ts:42:7)"),
	});
});

function fakeSentry(
	routes: Record<string, { status?: number; body: unknown; link?: string }>,
	origin = "https://sentry.io",
) {
	const calls: string[] = [];
	const fetchImpl = (async (url: string, init: RequestInit) => {
		const key = `${init.method ?? "GET"} ${url}`;
		calls.push(
			`${key} ${(init.headers as Record<string, string>).Authorization}${init.body ? ` ${init.body}` : ""}`,
		);
		const route = routes[key];
		if (!route) throw new Error(`unexpected ${key}`);
		return {
			ok: (route.status ?? 200) < 400,
			status: route.status ?? 200,
			headers: new Headers(route.link ? { link: route.link } : {}),
			json: async () => route.body,
		} as Response;
	}) as typeof fetch;
	return {
		calls,
		client: sentryClient("sntryu_token", { origin, fetch: fetchImpl }),
	};
}

it("sends the token saved now: a token replaced by connect sentry works without a restart", async () => {
	let token = "sntryu_old";
	const calls: string[] = [];
	const client = sentryClient(() => token, {
		origin: "https://sentry.io",
		fetch: (async (_url: string, init: RequestInit) => {
			calls.push((init.headers as Record<string, string>).Authorization ?? "");
			return {
				ok: true,
				status: 201,
				headers: new Headers(),
				json: async () => ({}),
			} as Response;
		}) as typeof fetch,
	});
	const where = { organization: "acme", project: "web" };
	await client.note(where, "1", "a");
	token = "sntryu_new";
	await client.note(where, "1", "b");
	expect(calls).toEqual(["Bearer sntryu_old", "Bearer sntryu_new"]);
});

it("never sends the token to another Sentry than the one it is for", async () => {
	const { calls, client } = fakeSentry({}, "https://sentry.io");
	await expect(
		client.note(
			{ organization: "acme", project: "web", url: "https://evil.example" },
			"1",
			"x",
		),
	).rejects.toThrow(
		'https://evil.example is not the Sentry the token is for (https://sentry.io); run "openfabriq connect sentry"',
	);
	expect(calls).toEqual([]);
});

const project = { organization: "acme", project: "web-app" };
it("reads an issue and its latest event, and adds notes, on a self-hosted Sentry too", async () => {
	const self = { ...project, url: "https://sentry.acme.dev" };
	const base = "https://sentry.acme.dev/api/0/organizations/acme/issues/123/";
	const { calls, client } = fakeSentry(
		{
			[`GET ${base}`]: { body: { shortId: "WEB-APP-12", title: "T" } },
			[`GET ${base}events/latest/`]: {
				status: 404,
				body: { detail: "Event not found" },
			},
			[`POST ${base}comments/`]: {
				status: 201,
				body: { id: "9", type: "note" },
			},
		},
		self.url,
	);
	expect(await client.issueContext(self, "123")).toMatchObject({
		short_id: "WEB-APP-12",
		stack_trace: undefined,
	});
	await client.note(
		self,
		"123",
		"Issue opened: https://github.com/acme/web-app/issues/10",
	);
	expect(calls.at(-1)).toBe(
		`POST ${base}comments/ Bearer sntryu_token {"text":"Issue opened: https://github.com/acme/web-app/issues/10"}`,
	);
	const refused = fakeSentry(
		{
			[`POST ${base}comments/`]: {
				status: 403,
				body: { detail: "You do not have permission" },
			},
		},
		self.url,
	);
	await expect(refused.client.note(self, "123", "x")).rejects.toThrow(
		"Sentry POST /api/0/organizations/acme/issues/123/comments/: 403 You do not have permission",
	);
});

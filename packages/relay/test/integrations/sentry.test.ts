import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MAX_PAGES } from "../../src/integrations/sentry/api";
import { call, ENGINE, relay } from "../helpers";

const SENTRY = "https://sentry.test";

interface Issue {
	id: string;
	shortId: string;
	permalink: string;
	firstSeen: string;
}

interface Request_ {
	url: URL;
	authorization: string | null;
}

/** Stands in for Sentry: answers with the issues first seen after the query's bound. */
function fakeSentry(
	options: {
		issues?: Issue[];
		status?: number;
		link?: (url: URL) => string | undefined;
	} = {},
) {
	const requests: Request_[] = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		requests.push({ url, authorization: request.headers.get("Authorization") });
		if (options.status)
			return Response.json(
				{ detail: "Invalid token" },
				{ status: options.status },
			);
		if (url.pathname === "/api/0/projects/acme/web/")
			return Response.json({ id: "42" });
		const bound = /firstSeen:>(\S+)/.exec(url.searchParams.get("query") ?? "");
		const after = new Date(bound?.[1] ?? 0).getTime();
		const found = (options.issues ?? []).filter(
			(i) => new Date(i.firstSeen).getTime() > after,
		);
		const link = options.link?.(url);
		return Response.json(found, link ? { headers: { Link: link } } : {});
	});
	return requests;
}

const issue = (id: string, firstSeen: number): Issue => ({
	id,
	shortId: `WEB-${id}`,
	permalink: `${SENTRY}/issues/${id}/`,
	firstSeen: new Date(firstSeen).toISOString(),
});

function configureSentry(url = SENTRY, token = "sentry-token") {
	return call("/config/sentry", {
		method: "POST",
		headers: ENGINE,
		body: JSON.stringify({ token, url }),
	});
}

function watch(watches: unknown) {
	return call("/config/sentry/watches", {
		method: "PUT",
		headers: ENGINE,
		body: JSON.stringify({ watches }),
	});
}

function state() {
	return runInDurableObject(relay(), async (_instance, s) => ({
		events: s.storage.sql
			.exec<{ body: string }>("SELECT body FROM events ORDER BY received_at")
			.toArray()
			.map((row) => JSON.parse(row.body)),
		watches:
			s.storage.kv.get<Record<string, unknown>[]>("sentry:watches") ?? [],
		alarm: await s.storage.getAlarm(),
	}));
}

const sentryEvents = async () =>
	(await state()).events.filter((e) => e.service === "sentry");

beforeEach(async () => {
	await runInDurableObject(relay(), async (_instance, s) => {
		s.storage.kv.delete("sentry:config");
		s.storage.kv.delete("sentry:watches");
		s.storage.sql.exec("DELETE FROM events");
		s.storage.sql.exec("DELETE FROM deliveries");
		await s.storage.deleteAlarm();
	});
});
afterEach(() => {
	vi.restoreAllMocks();
});

it("needs the engine token to configure Sentry and its watches", async () => {
	const config = await call("/config/sentry", {
		method: "POST",
		body: JSON.stringify({ token: "t", url: SENTRY }),
	});
	expect(config.status).toBe(401);
	const watches = await call("/config/sentry/watches", {
		method: "PUT",
		headers: { Authorization: "Bearer wrong" },
		body: JSON.stringify({ watches: [] }),
	});
	expect(watches.status).toBe(401);
});

it("refuses a bad Sentry configuration or watch list", async () => {
	for (const body of [
		{ token: "t" },
		{ token: "", url: SENTRY },
		{ token: "t", url: "not a url" },
		{ token: "t", url: "ftp://sentry.test" },
	]) {
		const response = await call("/config/sentry", {
			method: "POST",
			headers: ENGINE,
			body: JSON.stringify(body),
		});
		expect(response.status).toBe(400);
		expect(await response.text()).toBe("Expected { token, url }.");
	}
	for (const watches of [
		undefined,
		[{ organization: "acme" }],
		[{ organization: "", project: "web" }],
		[{ organization: "acme", project: "web", query: 3 }],
	]) {
		const response = await watch(watches);
		expect(response.status).toBe(400);
	}
});

it("polls within a minute once configured and watched", async () => {
	expect((await configureSentry()).status).toBe(204);
	expect((await watch([{ organization: "acme", project: "web" }])).status).toBe(
		204,
	);
	const { alarm } = await state();
	expect(alarm).not.toBeNull();
	expect(alarm ?? Infinity).toBeLessThanOrEqual(Date.now() + 60_000);
});

it("polls again in a minute even when a poll throws", async () => {
	await configureSentry();
	await watch([{ organization: "acme", project: "web" }]);
	const before = Date.now();
	const failed = await runInDurableObject(relay(), async (instance, s) => {
		const { sentry } = instance as unknown as {
			sentry: { poll(): Promise<void> };
		};
		vi.spyOn(sentry, "poll").mockRejectedValue(new Error("storage failed"));
		await s.storage.deleteAlarm();
		return instance.alarm().then(
			() => undefined,
			(error: Error) => error.message,
		);
	});
	expect(failed).toBe("storage failed");
	const { alarm } = await state();
	expect(alarm).toBeGreaterThanOrEqual(before + 60_000);
	expect(alarm).toBeLessThanOrEqual(Date.now() + 60_000);
});

it("queues only the issues first seen after the watch was added", async () => {
	await configureSentry();
	const before = Date.now();
	await watch([{ organization: "acme", project: "web", query: "level:error" }]);
	const since = Number((await state()).watches[0]?.since);
	expect(since).toBeGreaterThanOrEqual(before);
	const requests = fakeSentry({
		issues: [issue("1", before - 3_600_000), issue("2", Date.now() + 60_000)],
	});
	expect(await runDurableObjectAlarm(relay())).toBe(true);

	const search = requests.find((r) => r.url.pathname.endsWith("/issues/"));
	expect(search?.url.pathname).toBe("/api/0/organizations/acme/issues/");
	expect(Object.fromEntries(search?.url.searchParams ?? [])).toEqual({
		project: "42",
		query: `level:error firstSeen:>${new Date(since).toISOString().slice(0, 19)}Z`,
		sort: "new",
		statsPeriod: "14d",
		limit: "100",
	});
	expect(await sentryEvents()).toEqual([
		{
			id: expect.any(String),
			receivedAt: expect.any(Number),
			service: "sentry",
			kind: "issue",
			organization: "acme",
			project: "web",
			query: "level:error",
			issue: {
				id: "2",
				shortId: "WEB-2",
				permalink: `${SENTRY}/issues/2/`,
				firstSeen: expect.any(String),
			},
		},
	]);
	expect((await state()).alarm).not.toBeNull();
});

it("never searches before the watch was added, even with the overlap", async () => {
	await configureSentry();
	const before = Date.now();
	await watch([{ organization: "acme", project: "web", query: "level:error" }]);
	// Seen 30 seconds before the watch: inside the two minutes the next search goes back.
	fakeSentry({ issues: [issue("1", before - 30_000)] });
	await runDurableObjectAlarm(relay());
	await runDurableObjectAlarm(relay());
	expect(await sentryEvents()).toEqual([]);
});

/** Moves a watch's point back, as if it had been added that long ago. */
const ageWatch = (ms: number) =>
	runInDurableObject(relay(), async (_instance, s) => {
		const watches =
			s.storage.kv.get<{ since: number }[]>("sentry:watches") ?? [];
		s.storage.kv.put(
			"sentry:watches",
			watches.map((w) => ({ ...w, since: w.since - ms })),
		);
	});

it("queues an issue once across two polls, which overlap by two minutes", async () => {
	await configureSentry();
	await watch([{ organization: "acme", project: "web" }]);
	await ageWatch(10 * 60_000);
	const requests = fakeSentry({ issues: [issue("7", Date.now() + 60_000)] });
	await runDurableObjectAlarm(relay());
	const started = Date.now();
	await runDurableObjectAlarm(relay());

	expect((await sentryEvents()).map((e) => e.issue.id)).toEqual(["7"]);
	const searches = requests.filter((r) => r.url.pathname.endsWith("/issues/"));
	const bound = (r?: Request_) =>
		new Date(
			/firstSeen:>(\S+)/.exec(r?.url.searchParams.get("query") ?? "")?.[1] ?? 0,
		).getTime();
	expect(searches[1]?.url.searchParams.get("query")).toMatch(/^is:unresolved /);
	expect(bound(searches[1])).toBeLessThanOrEqual(started - 120_000);
	expect(bound(searches[1])).toBeGreaterThan(started - 125_000);
	// The project id is asked once.
	expect(
		requests.filter((r) => r.url.pathname.startsWith("/api/0/projects/")),
	).toHaveLength(1);
});

it("reads at most a few pages per poll", async () => {
	await configureSentry();
	await watch([{ organization: "acme", project: "web" }]);
	const requests = fakeSentry({
		link: (url) =>
			`<${url.href}&cursor=next>; rel="next"; results="true"; cursor="next"`,
	});
	await runDurableObjectAlarm(relay());
	expect(
		requests.filter((r) => r.url.pathname.endsWith("/issues/")),
	).toHaveLength(MAX_PAGES);
});

it("says an error once, and again only after a success", async () => {
	await configureSentry();
	await watch([{ organization: "acme", project: "web" }]);
	fakeSentry({ status: 401 });
	await runDurableObjectAlarm(relay());
	await runDurableObjectAlarm(relay());
	expect(await sentryEvents()).toEqual([
		{
			id: expect.any(String),
			receivedAt: expect.any(Number),
			service: "sentry",
			kind: "error",
			organization: "acme",
			project: "web",
			message: "Sentry GET /api/0/projects/acme/web/: 401 Invalid token",
		},
	]);
	await ageWatch(10 * 60_000);
	const failedSince = (await state()).watches[0]?.since;

	vi.restoreAllMocks();
	fakeSentry();
	await runDurableObjectAlarm(relay());
	const healed = (await state()).watches[0];
	expect(healed?.lastError).toBeUndefined();
	expect(healed?.since).not.toBe(failedSince);

	vi.restoreAllMocks();
	fakeSentry({ status: 401 });
	await runDurableObjectAlarm(relay());
	expect((await sentryEvents()).filter((e) => e.kind === "error")).toHaveLength(
		2,
	);
});

it("keeps a kept watch's point when the list is replaced, and forgets a removed one", async () => {
	await configureSentry();
	await watch([
		{ organization: "acme", project: "web" },
		{ organization: "acme", project: "api" },
	]);
	fakeSentry();
	await runDurableObjectAlarm(relay());
	const kept = (await state()).watches.find((w) => w.project === "web");

	await watch([
		{ organization: "acme", project: "web" },
		{ organization: "acme", project: "web", query: "level:fatal" },
	]);
	const { watches } = await state();
	expect(watches).toHaveLength(2);
	expect(watches[0]).toEqual(kept);
	expect(watches[1]).toEqual({
		organization: "acme",
		project: "web",
		query: "level:fatal",
		since: expect.any(Number),
	});
	expect(watches[1]?.since).toBeGreaterThan(Number(kept?.since));
});

it("sends the token only to the Sentry it is for", async () => {
	await configureSentry("https://sentry.test/some/path");
	await watch([{ organization: "acme", project: "web" }]);
	const requests = fakeSentry({
		link: () =>
			'<https://elsewhere.test/api/0/organizations/acme/issues/?cursor=x>; rel="next"; results="true"',
	});
	await runDurableObjectAlarm(relay());

	expect(requests.map((r) => r.url.origin)).toEqual([SENTRY, SENTRY]);
	expect(requests.every((r) => r.authorization === "Bearer sentry-token")).toBe(
		true,
	);
	expect((await sentryEvents()).map((e) => e.message)).toEqual([
		"https://elsewhere.test is not the Sentry the token is for (https://sentry.test)",
	]);
});

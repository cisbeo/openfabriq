import { expect, it } from "vitest";
import {
	askSubject,
	linearIssueState,
	sentryIssueState,
} from "../../src/subjects/ask-subject.js";

const linearUrl = "https://linear.app/acme/issue/ENG-12/filter-tasks";

/** A fake Linear: each token answers for its own workspace, or not at all. */
const linearFetch = (
	answers: Record<string, { url: string; type: string } | undefined>,
	asked: string[] = [],
) =>
	(async (
		_url: string,
		init: { headers: Record<string, string>; body: string },
	) => {
		const token = init.headers.Authorization ?? "";
		const { variables } = JSON.parse(init.body) as {
			variables: { id: string };
		};
		asked.push(`${token} ${variables.id}`);
		const issue = answers[token];
		return new Response(
			JSON.stringify(
				issue
					? { data: { issue: { url: issue.url, state: { type: issue.type } } } }
					: { errors: [{ message: "Entity not found" }] },
			),
		);
	}) as unknown as typeof fetch;

it.each([
	["started", true],
	["completed", false],
	["canceled", false],
	["duplicate", false],
])("reads a Linear issue in state %s as open: %s", async (type, open) => {
	const asked: string[] = [];
	const state = await linearIssueState(
		linearUrl,
		async () => [{ accessToken: "t1" }],
		linearFetch({ "Bearer t1": { url: linearUrl, type } }, asked),
	);
	expect(state).toEqual({ merged: false, open });
	expect(asked).toEqual(["Bearer t1 ENG-12"]);
});

it("takes a Linear issue only from the organization of its workspace", async () => {
	const other = "https://linear.app/other/issue/ENG-12/something-else";
	const fetchImpl = linearFetch({
		"Bearer t1": { url: other, type: "completed" },
		"Bearer t2": { url: linearUrl, type: "started" },
	});
	expect(
		await linearIssueState(
			linearUrl,
			async () => [{ accessToken: "t1" }, { accessToken: "t2" }],
			fetchImpl,
		),
	).toEqual({ merged: false, open: true });
	expect(
		await linearIssueState(
			linearUrl,
			async () => [{ accessToken: "t1" }],
			fetchImpl,
		),
	).toBeUndefined();
});

it.each([
	["unresolved", true],
	["reprocessing", true],
	["resolved", false],
	["ignored", false],
])("reads a Sentry issue %s as open: %s", async (status, open) => {
	const asked: string[] = [];
	const sentry = {
		status: async (p: { organization: string }, id: string) => {
			asked.push(`${p.organization} ${id}`);
			if (p.organization !== "acme") throw new Error("Sentry GET: 404");
			return status;
		},
	};
	const projects = [
		{ organization: "other", project: "api" },
		{ organization: "acme", project: "web-app" },
	];
	expect(
		await sentryIssueState(
			"https://acme.sentry.io/issues/123/",
			sentry,
			projects,
		),
	).toEqual({ merged: false, open });
	expect(asked).toEqual(["other 123", "acme 123"]);
	expect(
		await sentryIssueState("https://acme.sentry.io/issues/", sentry, projects),
	).toBeUndefined();
});

it("asks Linear through the relay, Sentry on the token's origin only, and GitHub through gh", async () => {
	const calls: string[] = [];
	const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push(`${init?.method ?? "GET"} ${url}`);
		if (url.endsWith("/tokens/linear"))
			return Response.json({
				organizations: [
					{
						organizationId: "o1",
						accessToken: "lin",
						expiresAt: Date.now() + 3_600_000,
					},
				],
			});
		if (url === "https://api.linear.app/graphql")
			return Response.json({
				data: { issue: { url: linearUrl, state: { type: "completed" } } },
			});
		if (url === "https://sentry.io/api/0/organizations/acme/issues/123/")
			return Response.json({ status: "resolved" });
		return new Response("{}", { status: 404 });
	}) as typeof fetch;
	const state = askSubject(
		async (url) => ({ merged: true, open: false, url }) as never,
		() => ({
			relay: { url: "https://relay.example", token: "r" },
			sentry: { token: "s" },
		}),
		() => [
			{ organization: "acme", project: "web-app" },
			// Another Sentry: never sent the token.
			{
				organization: "acme",
				project: "web-app",
				url: "https://sentry.example",
			},
		],
		fetchImpl,
	);
	expect(await state(linearUrl)).toEqual({ merged: false, open: false });
	expect(await state("https://acme.sentry.io/issues/123/")).toEqual({
		merged: false,
		open: false,
	});
	expect(await state("https://github.com/acme/app/pull/5")).toMatchObject({
		url: "https://github.com/acme/app/pull/5",
	});
	expect(calls).toEqual([
		"GET https://relay.example/tokens/linear",
		"POST https://api.linear.app/graphql",
		"GET https://sentry.io/api/0/organizations/acme/issues/123/",
	]);
});

it("tells nothing when a service is not connected or its secrets cannot be read", async () => {
	const gh = async () => ({ merged: false, open: true });
	const none = askSubject(
		gh,
		() => ({}),
		() => [],
		(async () => {
			throw new Error("no network");
		}) as unknown as typeof fetch,
	);
	expect(await none(linearUrl)).toBeUndefined();
	expect(await none("https://acme.sentry.io/issues/123/")).toBeUndefined();
	const broken = askSubject(gh, () => {
		throw new Error("secrets.json is not valid JSON");
	});
	expect(await broken(linearUrl)).toBeUndefined();
});

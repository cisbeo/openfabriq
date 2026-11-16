import type { Factory } from "@openfabriq/core";
import { expect, it, vi } from "vitest";
import {
	delegationOf,
	type SessionEvent,
} from "../../src/sources/linear/delegation.js";
import {
	type IssueWebhook,
	labeledEventsFor,
	labelsAdded,
} from "../../src/sources/linear/labels.js";
import type { RelayEvent } from "../../src/sources/relay.js";
import {
	sentryIssueEventsFor,
	sentryWatches,
} from "../../src/sources/sentry/events.js";
import {
	PAYLOAD_KEPT,
	webhookEventsFor,
} from "../../src/sources/webhook/events.js";

// What the engine reads in the events the relay brings, and which factories they are for.

const relayEvent = (
	service: string,
	kind: string,
	fields: Record<string, unknown>,
): RelayEvent => ({
	id: "ev-1",
	receivedAt: Date.parse("2026-11-03T10:00:00Z"),
	service,
	kind,
	...fields,
});
const project = (repository: string, factory: object) => ({
	repository,
	factory: factory as Factory,
});

const labels = [
	{ id: "l1", name: "agent" },
	{ id: "l2", name: "bug" },
];

it("counts every label of an issue created with labels as added", () => {
	expect(labelsAdded({ action: "create", data: { labels } })).toEqual([
		"agent",
		"bug",
	]);
});

it("counts only the new labels of an update, from the ids it had before", () => {
	expect(
		labelsAdded({
			action: "update",
			data: { labels },
			updatedFrom: { labelIds: ["l2"] },
		}),
	).toEqual(["agent"]);
});

it("counts no label when an update did not change the labels, or removes an issue", () => {
	expect(
		labelsAdded({
			action: "update",
			data: { labels },
			updatedFrom: { title: "Old" } as never,
		}),
	).toEqual([]);
	expect(labelsAdded({ action: "remove", data: { labels } })).toEqual([]);
});

const factory = (
	sentry: Factory["sentry"],
	queries: (string | undefined)[],
): Factory =>
	({
		sentry,
		automations: Object.fromEntries(
			queries.map((query, i) => [
				`a${i}`,
				{
					when: [
						{ event: "sentry.issue.created", ...(query ? { query } : {}) },
						{ event: "issue.labeled" },
					],
				},
			]),
		),
	}) as unknown as Factory;

it("asks the relay for one search per project and query, only on the Sentry the token is for", () => {
	const watches = sentryWatches(
		[
			factory({ organization: "acme", project: "web" }, [
				"level:error",
				"level:error",
				undefined,
			]),
			factory({ organization: "acme", project: "web" }, ["level:error"]),
			factory(
				{
					organization: "acme",
					project: "api",
					url: "https://sentry.acme.dev",
				},
				["level:error"],
			),
			factory(undefined, []),
		],
		"https://sentry.io",
	);
	expect(watches).toEqual([
		{ organization: "acme", project: "web", query: "level:error" },
		{ organization: "acme", project: "web" },
	]);
});

it("queues a webhook for each factory that declares its name, its body cut for the agent", () => {
	const deploy = project("acme/a", { webhooks: { deploy: {} } });
	const other = project("acme/b", { webhooks: { billing: {} } });
	const body = "x".repeat(PAYLOAD_KEPT + 1);
	const event = relayEvent("webhook", "received", {
		webhook: "deploy",
		delivery: "d1",
		payload: body,
	});
	expect(webhookEventsFor(event, () => [deploy, other])).toEqual([
		{
			...deploy,
			event: {
				key: "webhook:deploy:d1",
				event: "webhook.received",
				isPullRequest: false,
				actor: "webhook deploy",
				at: "2026-11-03T10:00:00.000Z",
				source: {
					kind: "webhook",
					webhook: "deploy",
					delivery: "d1",
					payload: `${body.slice(0, PAYLOAD_KEPT)}\n[cut by the engine: the body had ${PAYLOAD_KEPT + 1} characters]`,
				},
			},
		},
	]);
	expect(
		webhookEventsFor({ ...event, delivery: undefined }, () => [deploy]),
	).toEqual([]);
});

it("queues a new Sentry issue for each factory that runs the search that found it", () => {
	const errors = project(
		"acme/web",
		factory({ organization: "acme", project: "web" }, ["level:error"]),
	);
	const all = project(
		"acme/all",
		factory({ organization: "acme", project: "web" }, [undefined]),
	);
	const event = relayEvent("sentry", "issue", {
		organization: "acme",
		project: "web",
		query: "level:error",
		issue: {
			id: "7",
			shortId: "WEB-7",
			permalink: "https://acme.sentry.io/issues/7/",
			firstSeen: "2026-11-03T09:59:00Z",
		},
	});
	expect(
		sentryIssueEventsFor(event, "https://sentry.io", () => [errors, all]),
	).toEqual([
		{
			...errors,
			event: {
				key: "sentry:7:level:error",
				event: "sentry.issue.created",
				isPullRequest: false,
				actor: "sentry",
				at: "2026-11-03T09:59:00Z",
				query: "level:error",
				source: {
					kind: "sentry",
					issueId: "7",
					shortId: "WEB-7",
					url: "https://acme.sentry.io/issues/7/",
				},
			},
		},
	]);
	// Sentry not connected, an issue without its link, a failed search: nothing.
	expect(sentryIssueEventsFor(event, undefined, () => [errors])).toEqual([]);
	const unlinked = { ...event, issue: { id: "7" } };
	expect(
		sentryIssueEventsFor(unlinked, "https://sentry.io", () => [errors]),
	).toEqual([]);
	const failed = { ...event, kind: "error" };
	expect(
		sentryIssueEventsFor(failed, "https://sentry.io", () => [errors]),
	).toEqual([]);
});

it("queues each label added to a Linear issue for each factory of its team", () => {
	const eng = project("acme/a", { linear: { team: "ENG" } });
	const ops = project("acme/b", { linear: { team: "OPS" } });
	const payload: IssueWebhook = {
		type: "Issue",
		action: "create",
		organizationId: "org-1",
		actor: { name: "Bob" },
		data: {
			id: "uuid-7",
			identifier: "ENG-7",
			url: "https://linear.app/acme/issue/ENG-7",
			labels,
			team: { key: "eng" },
		},
	};
	const event = relayEvent("linear", "webhook", { delivery: "d1", payload });
	expect(labeledEventsFor(event, payload, () => [eng, ops])).toEqual(
		["agent", "bug"].map((label) => ({
			...eng,
			event: {
				key: `linear:d1:${label}`,
				event: "linear.issue.labeled",
				isPullRequest: false,
				actor: "Bob",
				label,
				at: "2026-11-03T10:00:00.000Z",
				source: {
					kind: "linear",
					issueId: "uuid-7",
					identifier: "ENG-7",
					url: "https://linear.app/acme/issue/ENG-7",
					organizationId: "org-1",
				},
			},
		})),
	);
	const { organizationId: _, ...unknown } = payload;
	expect(labeledEventsFor(event, unknown, () => [eng])).toEqual([]);
});

const session = (over: Partial<SessionEvent> = {}): SessionEvent => ({
	type: "AgentSessionEvent",
	action: "created",
	organizationId: "org-1",
	createdAt: "2026-11-03T10:00:00Z",
	promptContext: "<issue>ENG-7</issue>",
	agentSession: {
		id: "session-1",
		creator: { name: "Bob" },
		issue: {
			id: "uuid-7",
			identifier: "ENG-7",
			url: "https://linear.app/acme/issue/ENG-7",
			team: { key: "eng" },
		},
	},
	...over,
});
const listening = (repository: string, team: string) =>
	({
		repository,
		linear: { team },
		automations: { a: { when: [{ event: "linear.issue.delegated" }] } },
	}) as unknown as Factory;

it("takes a delegated session for each factory of its team that listens, or says why not", () => {
	const event = relayEvent("linear", "webhook", {});
	const eng = listening("acme/a", "ENG");
	const deaf = { ...eng, repository: "acme/b", automations: {} } as Factory;
	expect(delegationOf(event, session(), () => [eng, deaf])).toEqual({
		queued: [
			{
				factory: eng,
				event: {
					key: "linear-session:session-1:created",
					event: "linear.issue.delegated",
					isPullRequest: false,
					actor: "Bob",
					at: "2026-11-03T10:00:00Z",
					source: {
						kind: "linear",
						issueId: "uuid-7",
						identifier: "ENG-7",
						url: "https://linear.app/acme/issue/ENG-7",
						session: {
							id: "session-1",
							organizationId: "org-1",
							request: "<issue>ENG-7</issue>",
						},
					},
				},
			},
		],
	});
	const refused = (reason: string) => ({
		refused: reason,
		session: { id: "session-1", organizationId: "org-1" },
	});
	expect(delegationOf(event, session(), () => [deaf])).toEqual(
		refused("No automation of this team listens to linear.issue.delegated."),
	);
	expect(
		delegationOf(event, session(), () => [listening("acme/c", "OPS")]),
	).toEqual(
		refused(
			"The Linear team eng is not the team of any factory: openfabriq does not work for it.",
		),
	);
	const outside = session({ agentSession: { id: "session-1", issue: null } });
	expect(delegationOf(event, outside, () => [eng])).toEqual(
		refused("openfabriq only works on a Linear issue."),
	);
	const stop = session({
		action: "prompted",
		agentActivity: { signal: "stop" },
	});
	expect(delegationOf(event, stop, () => [eng])).toEqual({
		unsupported: "stop is not supported yet",
	});
	const other = session({ action: "updated" });
	const read = vi.fn(() => [eng]);
	expect(delegationOf(event, other, read)).toBeUndefined();
	expect(delegationOf(event, stop, read)).toEqual({
		unsupported: "stop is not supported yet",
	});
	// Nothing to take: the applied factories are not read.
	expect(read).not.toHaveBeenCalled();
});

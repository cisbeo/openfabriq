import {
	type FactoryEvent,
	loadFactory,
	withAnswerMentions,
} from "@openfabriq/core";
import { expect, it } from "vitest";
import {
	labeledForUntrustedRun,
	pushedForUntrustedRun,
	withOpener,
} from "../../src/engine/provenance.js";
import type { RunRecord } from "../../src/state/journal.js";

const load = (files: Record<string, string>) => {
	const { factory } = loadFactory(files);
	if (!factory) throw new Error("invalid factory");
	return factory;
};
const run = (r: Partial<RunRecord>): RunRecord => ({
	id: "r1",
	repository: "acme/app",
	automation: "welcome",
	agent: "triage",
	event: "issue.opened",
	number: 7,
	isPullRequest: false,
	status: "succeeded",
	queuedAt: "2026-11-04T10:00:00Z",
	startedAt: "2026-11-04T10:00:00Z",
	endedAt: "2026-11-04T10:05:00Z",
	outputs: [{ action: "add_labels", summary: "ready", status: "applied" }],
	untrusted: true,
	...r,
});
const labeled = (e: Partial<FactoryEvent>): FactoryEvent => ({
	key: "labeled:1",
	event: "issue.labeled",
	number: 7,
	isPullRequest: false,
	actor: "factory-bot",
	label: "ready",
	at: "2026-11-04T10:04:00Z",
	...e,
});

it("takes a label the engine put for a run no maintainer started as that run's, not a maintainer's (VULN-009)", () => {
	const journal = (r: Partial<RunRecord>) => () => [run(r)];
	const check = (e: Partial<FactoryEvent>, r: Partial<RunRecord> = {}) =>
		labeledForUntrustedRun("acme/app", labeled(e), ["factory-bot"], journal(r));
	expect(check({})).toBe(true);
	// GitHub's clock may be a little ahead of the engine's.
	expect(check({ at: "2026-11-04T10:05:30Z" })).toBe(true);
	// Someone else, another issue, another time, a maintainer's run, no label applied: theirs.
	expect(check({ actor: "alice" })).toBe(false);
	expect(check({ number: 8 })).toBe(false);
	expect(check({ at: "2026-11-04T11:00:00Z" })).toBe(false);
	expect(check({}, { untrusted: false })).toBe(false);
	expect(check({}, { outputs: [] })).toBe(false);
	expect(check({ event: "issue.opened" })).toBe(false);
});

it("takes a label put on an issue a run no maintainer started opened as that run's", () => {
	const opened = {
		number: 3,
		outputs: [
			{
				action: "create_issue" as const,
				summary: "Auth",
				status: "applied" as const,
				url: "https://github.com/acme/app/issues/12",
			},
		],
	};
	const check = (e: Partial<FactoryEvent>, r: Partial<RunRecord> = {}) =>
		labeledForUntrustedRun("acme/app", labeled(e), ["factory-bot"], () => [
			run({ ...opened, ...r }),
		]);
	expect(check({ number: 12 })).toBe(true);
	expect(check({ number: 1 })).toBe(false);
	expect(check({ number: 12 }, { untrusted: false })).toBe(false);
	expect(check({ number: 12, actor: "alice" })).toBe(false);
});

it("takes the labels an untrusted run put on the pull request it opened as that run's, not a maintainer's", () => {
	const opened = run({
		number: 3,
		outputs: [
			{
				action: "create_pull_request",
				summary: "Fix the crash",
				status: "applied",
				url: "https://github.com/acme/app/pull/13",
			},
		],
	});
	const check = (e: Partial<FactoryEvent>, r: Partial<RunRecord> = {}) =>
		labeledForUntrustedRun(
			"acme/app",
			labeled({ event: "pull_request.labeled", isPullRequest: true, ...e }),
			["factory-bot"],
			() => [run({ ...opened, ...r })],
		);
	expect(check({ number: 13 })).toBe(true);
	expect(check({ number: 14 })).toBe(false);
	expect(check({ number: 13 }, { untrusted: false })).toBe(false);
});

it("takes a push or a check of a pull request an untrusted run pushed to as that run's, not its author's", () => {
	const pushed = run({
		number: 4,
		isPullRequest: true,
		outputs: [
			{ action: "push_to_pull_request", summary: "Fix", status: "applied" },
		],
	});
	const check = (e: Partial<FactoryEvent>, r: RunRecord = pushed) =>
		pushedForUntrustedRun(
			{
				key: "push:4:abc",
				event: "pull_request.updated",
				number: 4,
				isPullRequest: true,
				actor: "ada",
				at: "2026-11-04T11:00:00Z",
				...e,
			},
			() => [r],
		);
	expect(check({})).toBe(true);
	expect(check({ event: "pull_request.checks_failed" })).toBe(true);
	expect(check({ event: "pull_request.conflicted" })).toBe(true);
	// A maintainer's own comment, another pull request, a maintainer's run, a refused push: theirs.
	expect(check({ event: "pull_request.commented" })).toBe(false);
	expect(check({ number: 5 })).toBe(false);
	expect(check({}, { ...pushed, untrusted: false })).toBe(false);
	expect(
		check(
			{},
			{
				...pushed,
				outputs: [
					{ action: "push_to_pull_request", summary: "Fix", status: "refused" },
				],
			},
		),
	).toBe(false);
});

it("names the agent whose run opened a pull request, for the engine's answer to mentions", () => {
	const factory = withAnswerMentions(
		load({
			"factory.yaml": "name: F\nrepository: acme/app\nmaintainers: [ada]\n",
			"agents/implementer/agent.md":
				"---\ndescription: Builds\ntools: [read, edit, shell]\n---\nBuild.\n",
			"automations/implement/automation.md":
				"---\nwhen: issue.opened\nagent: implementer\ncan: [create_pull_request]\n---\nGo.\n",
		}),
	);
	const opened = run({
		agent: "implementer",
		untrusted: false,
		outputs: [
			{
				action: "create_pull_request",
				summary: "Add export",
				status: "applied",
				url: "https://github.com/acme/app/pull/12",
			},
		],
	});
	const opener = (
		e: Partial<FactoryEvent>,
		runs: () => RunRecord[] = () => [opened],
	) =>
		withOpener(
			factory,
			{
				key: "comment:12:1",
				event: "pull_request.commented",
				number: 12,
				isPullRequest: true,
				actor: "ada",
				text: "@openfabriq rename the export",
				at: "2026-11-08T11:00:00Z",
				...e,
			},
			runs,
		).openedBy;
	expect(opener({})).toBe("implementer");
	// A comment that does not mention the engine starts nothing: the journal is not read.
	expect(
		opener({ text: "Looks good" }, () => {
			throw new Error("the journal was read");
		}),
	).toBeUndefined();
	// Another pull request, a refused one, an event the engine does not answer: nobody.
	expect(opener({ number: 1 })).toBeUndefined();
	expect(opener({ event: "pull_request.conflicted" })).toBeUndefined();
	expect(opener({ event: "pull_request.changes_requested" })).toBeUndefined();
	const refused = run({
		...opened,
		outputs: [
			{ ...opened.outputs[0], status: "refused" } as RunRecord["outputs"][0],
		],
	});
	expect(opener({}, () => [refused])).toBeUndefined();
});

it("names the agent whose run opened an issue, for the engine's answer to mentions on issues", () => {
	const factory = withAnswerMentions(
		load({
			"factory.yaml": "name: F\nrepository: acme/app\nmaintainers: [ada]\n",
			"agents/planner/agent.md":
				"---\ndescription: Plans\ntools: [read]\n---\nPlan.\n",
			"automations/open-tickets/automation.md":
				"---\nwhen: { issue.labeled: { labels: [epic] } }\nagent: planner\ncan: [create_issue]\n---\nGo.\n",
		}),
	);
	const opened = run({
		agent: "planner",
		untrusted: false,
		outputs: [
			{
				action: "create_issue",
				summary: "T09 Go live",
				status: "applied",
				url: "https://github.com/acme/app/issues/35",
			},
		],
	});
	const opener = (e: Partial<FactoryEvent>) =>
		withOpener(
			factory,
			{
				key: "comment:35:1",
				event: "issue.commented",
				number: 35,
				isPullRequest: false,
				actor: "ada",
				text: "@openfabriq give me the deploy.yml",
				at: "2026-11-11T01:10:00Z",
				...e,
			},
			() => [opened],
		).openedBy;
	expect(opener({})).toBe("planner");
	// A pull request with the same number is not that issue.
	expect(opener({ number: 36 })).toBeUndefined();
	expect(opener({ text: "thanks" })).toBeUndefined();
});

it("on a pull request or an issue a person opened, the last agent of the factory that worked on it answers", () => {
	const factory = withAnswerMentions(
		load({
			"factory.yaml": "name: F\nrepository: acme/app\nmaintainers: [ada]\n",
			"agents/planner/agent.md":
				"---\ndescription: Plans\ntools: [read]\n---\nPlan.\n",
			"agents/triage/agent.md":
				"---\ndescription: Sorts\ntools: [read]\n---\nSort.\n",
			"automations/plan/automation.md":
				"---\nwhen: { issue.labeled: { labels: [discover] } }\nagent: planner\ncan: [create_pull_request, create_issue]\n---\nGo.\n",
			"automations/sort/automation.md":
				"---\nwhen: issue.opened\nagent: triage\ncan: [add_labels]\n---\nSort.\n",
		}),
	);
	// Latest first, as the journal gives them: the triage has no answer to mentions, the planner has.
	const runs = [
		run({
			id: "t2",
			agent: "triage",
			number: 1,
			queuedAt: "2026-11-11T10:00:00Z",
		}),
		run({
			id: "p1",
			agent: "planner",
			number: 1,
			queuedAt: "2026-11-10T10:00:00Z",
		}),
		run({
			id: "p2",
			agent: "planner",
			number: 4,
			isPullRequest: true,
			queuedAt: "2026-11-10T11:00:00Z",
		}),
	];
	const answerer = (e: Partial<FactoryEvent>) => {
		const out = withOpener(
			factory,
			{
				key: "comment:1:1",
				event: "issue.commented",
				number: 1,
				isPullRequest: false,
				actor: "ada",
				text: "@openfabriq ok we are live",
				at: "2026-11-11T10:36:00Z",
				...e,
			},
			() => runs,
		);
		return [out.openedBy, out.answeredBy];
	};
	// Nobody of the factory opened issue #1: openedBy stays empty, the planner answers.
	expect(answerer({})).toEqual([undefined, "planner"]);
	// Pull request #1 is another subject: nobody worked on it.
	expect(
		answerer({ isPullRequest: true, event: "pull_request.commented" }),
	).toEqual([undefined, undefined]);
	expect(
		answerer({
			number: 4,
			isPullRequest: true,
			event: "pull_request.commented",
		}),
	).toEqual([undefined, "planner"]);
	expect(answerer({ text: "thanks" })).toEqual([undefined, undefined]);
});

it("on a pull request an agent opened, only that agent answers, never the last one to work on it", () => {
	const factory = withAnswerMentions(
		load({
			"factory.yaml": "name: F\nrepository: acme/app\nmaintainers: [ada]\n",
			"agents/planner/agent.md":
				"---\ndescription: Plans\ntools: [read]\n---\nPlan.\n",
			"agents/builder/agent.md":
				"---\ndescription: Builds\ntools: [read, edit]\n---\nBuild.\n",
			"automations/plan/automation.md":
				"---\nwhen: { issue.labeled: { labels: [discover] } }\nagent: planner\ncan: [create_pull_request]\n---\nGo.\n",
			"automations/build/automation.md":
				"---\nwhen: { issue.labeled: { labels: [ready] } }\nagent: builder\ncan: [create_pull_request]\n---\nGo.\n",
			// The factory answers on the planner's pull requests itself.
			"automations/revise/automation.md":
				'---\nwhen:\n  pull_request.commented: { mentions: "@openfabriq", opened_by: planner }\nagent: planner\ncan: [push_to_pull_request]\n---\nGo.\n',
		}),
	);
	const runs = [
		run({ id: "b1", agent: "builder", number: 9, isPullRequest: true }),
		run({
			id: "p1",
			agent: "planner",
			untrusted: false,
			outputs: [
				{
					action: "create_pull_request",
					summary: "The plan",
					status: "applied",
					url: "https://github.com/acme/app/pull/9",
				},
			],
		}),
	];
	const out = withOpener(
		factory,
		{
			key: "comment:9:1",
			event: "pull_request.commented",
			number: 9,
			isPullRequest: true,
			actor: "ada",
			text: "@openfabriq change the plan",
			at: "2026-11-11T10:36:00Z",
		},
		() => runs,
	);
	expect([out.openedBy, out.answeredBy]).toEqual(["planner", undefined]);
});

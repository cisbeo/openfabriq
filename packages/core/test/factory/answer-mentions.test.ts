import { describe, expect, it } from "vitest";
import { withAnswerMentions } from "../../src/factory/answer-mentions.js";
import { loadFactory } from "../../src/factory/load.js";
import type { FactoryFiles } from "../../src/factory/types.js";
import { type FactoryEvent, matchingAutomations } from "../../src/match.js";
import { planChanges } from "../../src/plan/plan.js";
import { load, NO_FILES } from "../helpers.js";

const FACTORY = "name: F\nrepository: acme/app\nmaintainers: [alice]\n";
const agent = (name: string) => ({
	[`agents/${name}/agent.md`]: `---\ndescription: ${name}\ntools: [read, edit, shell]\n---\nWork.\n`,
});
const files = (yaml = "", extra: FactoryFiles = {}): FactoryFiles => ({
	"factory.yaml": FACTORY + yaml,
	...agent("implementer"),
	...agent("triager"),
	"automations/implement/automation.md":
		"---\nwhen: issue.opened\nagent: implementer\ncan: [create_pull_request]\n---\nGo.\n",
	"automations/triage/automation.md":
		"---\nwhen: issue.opened\nagent: triager\ncan: [add_comment]\n---\nTriage.\n",
	...extra,
});
const messages = (f: FactoryFiles) =>
	loadFactory(f).problems.map((p) => `${p.file}: ${p.message}`);

const mention = (more: Partial<FactoryEvent> = {}): FactoryEvent => ({
	key: "k",
	event: "pull_request.commented",
	number: 7,
	isPullRequest: true,
	actor: "alice",
	at: "2026-11-08T10:00:00Z",
	text: "@openfabriq add a test please",
	answeredBy: "implementer",
	...more,
});
const started = (factory: ReturnType<typeof load>, event: FactoryEvent) =>
	matchingAutomations(factory, event).map((a) => a.name);

describe("the engine's answer to mentions", () => {
	it("is on by default, and answer_mentions: false turns it off", () => {
		expect(load(files()).answerMentions).toBeUndefined();
		expect(load(files("answer_mentions: false\n")).answerMentions).toBe(false);
		expect(messages(files("answer_mentions: maybe\n"))).toEqual([
			"factory.yaml: answer_mentions: is true or false; false: the engine no longer answers mentions of @openfabriq on its pull requests",
		]);
		expect(
			withAnswerMentions(load(files("answer_mentions: false\n"))).automations,
		).toEqual(load(files()).automations);
	});

	it("gives each agent that opens pull requests a native automation on mentions of them", () => {
		const factory = withAnswerMentions(load(files()));
		expect(Object.keys(factory.automations).sort()).toEqual([
			"answer-mentions-implementer",
			"implement",
			"triage",
		]);
		expect(factory.automations["answer-mentions-implementer"]).toMatchObject({
			builtIn: true,
			agent: "implementer",
			when: [
				{
					event: "pull_request.commented",
					mentions: "@openfabriq",
					answeredBy: "implementer",
				},
				// It works on issues people label too: there, it only comments.
				{
					event: "issue.commented",
					mentions: "@openfabriq",
					answeredBy: "implementer",
				},
			],
			can: [{ action: "push_to_pull_request" }, { action: "add_comment" }],
			concurrency: "issue",
			from: "maintainers",
		});
	});

	it("starts only on a maintainer's mention, on the pull requests its agent opened", () => {
		const factory = withAnswerMentions(load(files()));
		expect(started(factory, mention())).toEqual([
			"answer-mentions-implementer",
		]);
		expect(started(factory, mention({ text: "Looks good to me" }))).toEqual([]);
		const { answeredBy: _, ...byAPerson } = mention();
		expect(started(factory, byAPerson)).toEqual([]);
		expect(started(factory, mention({ actor: "mallory" }))).toEqual([]);
		expect(
			started(factory, mention({ event: "pull_request.conflicted" })),
		).toEqual([]);
	});

	it("leaves pull request comments to the factory when one of its automations listens to them", () => {
		const factory = load(
			files("", {
				"automations/answer/automation.md":
					'---\nwhen:\n  pull_request.commented: { mentions: "/factory" }\nagent: implementer\ncan: [push_to_pull_request]\n---\nGo.\n',
			}),
		);
		// Pull request comments are the factory's; the implementer still answers on issues.
		expect(
			withAnswerMentions(factory).automations["answer-mentions-implementer"]
				?.when,
		).toEqual([
			{
				event: "issue.commented",
				mentions: "@openfabriq",
				answeredBy: "implementer",
			},
		]);
	});

	it("leaves to the factory only the pull requests its automation names with opened_by", () => {
		const factory = load(
			files("", {
				...agent("planner"),
				"automations/record/automation.md":
					"---\nwhen: issue.labeled\nagent: planner\ncan: [create_pull_request]\n---\nGo.\n",
				"automations/revise/automation.md":
					"---\nwhen:\n  pull_request.commented: { labels: [needs-human], opened_by: planner }\nagent: planner\ncan: [push_to_pull_request]\n---\nGo.\n",
			}),
		);
		const automations = withAnswerMentions(factory).automations;
		const onPulls = (agent: string) =>
			automations[`answer-mentions-${agent}`]?.when.some(
				(w) => w.event === "pull_request.commented",
			);
		// The implementer still answers on its pull requests; the planner's are the factory's.
		expect(onPulls("implementer")).toBe(true);
		expect(onPulls("planner")).toBe(false);
	});

	const filing = files("", {
		"automations/file/automation.md":
			"---\nwhen: { issue.labeled: { labels: [epic] } }\nagent: triager\ncan: [create_issue]\n---\nFile.\n",
	});
	const issueMention = (more: Partial<FactoryEvent> = {}): FactoryEvent =>
		mention({
			event: "issue.commented",
			isPullRequest: false,
			answeredBy: "triager",
			...more,
		});

	it("gives each agent that opens issues a native automation on mentions on its issues: it only comments", () => {
		const factory = withAnswerMentions(load(filing));
		expect(factory.automations["answer-mentions-triager"]).toMatchObject({
			builtIn: true,
			agent: "triager",
			when: [
				{
					event: "issue.commented",
					mentions: "@openfabriq",
					answeredBy: "triager",
				},
			],
			can: [{ action: "add_comment" }],
			concurrency: "issue",
			from: "maintainers",
		});
		expect(started(factory, issueMention())).toEqual([
			"answer-mentions-triager",
		]);
		expect(started(factory, issueMention({ text: "Thanks" }))).toEqual([]);
		const { answeredBy: _, ...byAPerson } = issueMention();
		expect(started(factory, byAPerson)).toEqual([]);
		expect(started(factory, issueMention({ actor: "mallory" }))).toEqual([]);
		expect(
			withAnswerMentions(load(files("answer_mentions: false\n"))).automations,
		).toEqual(load(files()).automations);
	});

	it("leaves issue comments to the factory when one of its automations listens to them", () => {
		const factory = load(
			files("", {
				"automations/file/automation.md":
					"---\nwhen: { issue.labeled: { labels: [epic] } }\nagent: triager\ncan: [create_issue]\n---\nFile.\n",
				"automations/retriage/automation.md":
					"---\nwhen: issue.commented\nagent: triager\ncan: [add_comment]\n---\nAgain.\n",
			}),
		);
		expect(
			Object.keys(withAnswerMentions(factory).automations).filter(
				(n) => n === "answer-mentions-triager",
			),
		).toEqual([]);
	});

	it("plan says who answers on issues too", () => {
		expect(
			planChanges(
				undefined,
				withAnswerMentions(load(filing)),
				[],
				NO_FILES,
			).security.filter((l) => l.includes("answer-mentions")),
		).toEqual([
			"+ answer-mentions: the agent that opens pull requests, implementer, answers a maintainer's mention of @openfabriq on its pull requests: it may push to them and comment; on issues, implementer and triager answer it with a comment; on one a person opened, the last of them to work on it answers (answer_mentions: false in factory.yaml turns it off)",
		]);
	});

	it("reserves answer-mentions-<agent> for the agents of the factory", () => {
		expect(
			messages(
				files("", {
					"automations/answer-mentions-implementer/automation.md":
						"---\nwhen: issue.opened\nagent: triager\n---\nMine.\n",
				}),
			),
		).toEqual([
			"automations/answer-mentions-implementer/automation.md: an automation cannot be called answer-mentions-implementer: the engine answers mentions on implementer's pull requests and issues under that name. Rename it",
		]);
	});

	it("plan says who answers, as a security change, and ignores the automations it adds", () => {
		const security = (before: string | undefined, after: string) =>
			planChanges(
				before === undefined
					? undefined
					: withAnswerMentions(load(files(before))),
				withAnswerMentions(load(files(after))),
				[],
				NO_FILES,
			).security.filter((l) => l.includes("answer-mentions"));
		const line =
			"the agent that opens pull requests, implementer, answers a maintainer's mention of @openfabriq on its pull requests: it may push to them and comment; on issues, implementer answers it with a comment; on one a person opened, the last of them to work on it answers (answer_mentions: false in factory.yaml turns it off)";
		expect(security(undefined, "")).toEqual([`+ answer-mentions: ${line}`]);
		expect(security("", "")).toEqual([]);
		expect(security("", "answer_mentions: false\n")).toEqual([
			"- answer-mentions: off",
		]);
		expect(
			planChanges(
				withAnswerMentions(load(files())),
				load(files()),
				[],
				NO_FILES,
			).automations,
		).toEqual([]);
	});
});

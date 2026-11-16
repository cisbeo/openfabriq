import { expect, it } from "vitest";
import { loadFactory } from "../src/factory/load.js";
import {
	type FactoryEvent,
	matchingAutomations,
	needsChangedFiles,
	startedByMaintainer,
} from "../src/match.js";
import { mentionsWord } from "../src/vocabulary.js";
import { example, load, sdlcFiles } from "./helpers.js";

const factory = loadFactory(sdlcFiles()).factory;
if (!factory) throw new Error("the sdlc fixture should load");

const event = (e: Partial<FactoryEvent>): FactoryEvent => ({
	key: "k",
	event: "issue.opened",
	number: 1,
	isPullRequest: false,
	actor: "ada",
	at: "2026-11-01T00:00:00Z",
	...e,
});
const names = (e: FactoryEvent, trusted: string[] = []) =>
	matchingAutomations(factory, e, trusted).map((a) => a.name);

it("matches the event and its label filter", () => {
	expect(names(event({ event: "issue.opened" }))).toEqual(["triage-issues"]);
	expect(
		names(event({ event: "issue.labeled", label: "ready-for-agent" })),
	).toEqual(["implement-ready-issues"]);
	expect(names(event({ event: "issue.labeled", label: "bug" }))).toEqual([]);
	// GitHub label names ignore case.
	expect(
		names(event({ event: "issue.labeled", label: "Ready-For-Agent" })),
	).toEqual(["implement-ready-issues"]);
	expect(
		names(event({ event: "pull_request.updated", isPullRequest: true })),
	).toEqual(["review-pull-requests"]);
});

it("starts on new commits on the default branch whoever wrote them", () => {
	const docs = loadFactory({
		...sdlcFiles(),
		"automations/refresh-docs/automation.md":
			"---\nwhen: default_branch.updated\nagent: implementer\ncan: [create_pull_request]\n---\nUpdate the docs.\n",
	}).factory;
	if (!docs) throw new Error("should load");
	const { number: _, ...updated } = event({
		event: "default_branch.updated",
		actor: "outside-contributor",
	});
	expect(matchingAutomations(docs, updated).map((a) => a.name)).toEqual([
		"refresh-docs",
	]);
});

it("ignores people who are not maintainers, except trusted ones", () => {
	expect(names(event({ actor: "stranger" }))).toEqual([]);
	expect(names(event({ actor: "ADA" }))).toEqual(["triage-issues"]);
	expect(names(event({ actor: "bot-user" }), ["bot-user"])).toEqual([
		"triage-issues",
	]);
});

it("starts an automation open to anyone for someone who is not a maintainer", () => {
	const open = load({
		...sdlcFiles(),
		"automations/welcome/automation.md":
			"---\nwhen: issue.opened\nagent: triage\nfrom: anyone\ncan: [add_comment]\n---\nWelcome.\n",
	});
	const starts = (actor: string) =>
		matchingAutomations(open, event({ actor })).map((a) => a.name);
	expect(starts("stranger")).toEqual(["welcome"]);
	expect(starts("ada")).toEqual(["triage-issues", "welcome"]);
});

it("skips a pull request whose changed files all match ignore_paths", () => {
	const ignoring = loadFactory({
		...sdlcFiles(),
		"automations/review-pull-requests/automation.md":
			'---\nwhen:\n  pull_request.opened: { ignore_paths: ["openfabriq/**"] }\nagent: reviewer\ncan: [add_comment]\n---\nReview.\n',
	}).factory;
	if (!ignoring) throw new Error("should load");
	const opened = event({ event: "pull_request.opened", isPullRequest: true });
	expect(needsChangedFiles(ignoring, opened)).toBe(true);
	expect(needsChangedFiles(factory, opened)).toBe(false);
	// Only a pull request, with a number, on the event that has ignore_paths.
	expect(needsChangedFiles(ignoring, { ...opened, isPullRequest: false })).toBe(
		false,
	);
	const { number: _, ...unnumbered } = opened;
	expect(needsChangedFiles(ignoring, unnumbered)).toBe(false);
	expect(
		needsChangedFiles(ignoring, { ...opened, event: "pull_request.updated" }),
	).toBe(false);
	const match = (files?: string[]) =>
		matchingAutomations(ignoring, {
			...opened,
			...(files ? { files } : {}),
		}).map((a) => a.name);
	expect(match(["openfabriq/factory.yaml"])).toEqual([]);
	expect(match(["openfabriq/factory.yaml", "src/app.ts"])).toEqual([
		"review-pull-requests",
	]);
	// Files unknown: the engine could not tell, so the automation runs.
	expect(match()).toEqual(["review-pull-requests"]);
});

it("never takes what the engine wrote for a run no maintainer started as a maintainer's action (VULN-009)", () => {
	const open = load({
		...sdlcFiles(),
		"automations/welcome/automation.md":
			"---\nwhen: issue.opened\nagent: triage\nfrom: anyone\ncan: [add_comment]\n---\nWelcome.\n",
	});
	// The engine's account, even when it is a maintainer's (a laptop), opened it for a Sentry run:
	// triage only reads and comments, so it takes it.
	const written = event({ actor: "ada", fromUntrustedRun: true });
	expect(
		matchingAutomations(open, written, ["ada"]).map((a) => a.name),
	).toEqual(["triage-issues", "welcome"]);
	expect(startedByMaintainer(open, written, ["ada"])).toBe(false);
	expect(startedByMaintainer(open, event({}), [])).toBe(true);
	expect(startedByMaintainer(open, event({ actor: "stranger" }), [])).toBe(
		false,
	);
	// Slack and Linear: only members of the channel or the team write there.
	expect(startedByMaintainer(open, event({ event: "slack.mentioned" }))).toBe(
		true,
	);
	// Sentry: a public DSN lets anyone create an issue. Webhooks: whoever has the address.
	expect(
		startedByMaintainer(open, event({ event: "sentry.issue.created" })),
	).toBe(false);
	expect(startedByMaintainer(open, event({ event: "webhook.received" }))).toBe(
		false,
	);
	const { number: _, ...updated } = event({
		event: "default_branch.updated",
		actor: "outside-contributor",
	});
	expect(startedByMaintainer(open, updated)).toBe(true);
});

it("lets an automation that cannot push code nor reach a secret continue what the factory wrote, and the others only with from: factory", () => {
	const fromSentry = (e: Partial<FactoryEvent>) =>
		event({ actor: "factory-bot", fromUntrustedRun: true, ...e });
	// The reviewer comments: it reviews a pull request a Sentry run opened.
	expect(
		names(fromSentry({ event: "pull_request.opened", isPullRequest: true }), [
			"factory-bot",
		]),
	).toEqual(["review-pull-requests"]);
	// The implementer opens pull requests: not without from: factory.
	const ready = fromSentry({
		event: "issue.labeled",
		label: "ready-for-agent",
	});
	expect(names(ready, ["factory-bot"])).toEqual([]);
	const files = sdlcFiles();
	const path = "automations/implement-ready-issues/automation.md";
	const opened = load({
		...files,
		[path]: (files[path] ?? "").replace("---\n", "---\nfrom: factory\n"),
	});
	expect(
		matchingAutomations(opened, ready, ["factory-bot"]).map((a) => a.name),
	).toEqual(["implement-ready-issues"]);
	// from: factory is still closed to a stranger.
	expect(
		matchingAutomations(opened, { ...ready, actor: "stranger" }, [
			"factory-bot",
		]).map((a) => a.name),
	).toEqual([]);
});

it("counts setup and checks as reaching the factory's secrets: they run the chain's code with them", () => {
	const files = sdlcFiles();
	const yaml = files["factory.yaml"] ?? "";
	const reviewing = (extra: string) =>
		matchingAutomations(
			load({ ...files, "factory.yaml": `${yaml}${extra}` }),
			event({
				event: "pull_request.opened",
				isPullRequest: true,
				actor: "factory-bot",
				fromUntrustedRun: true,
			}),
			["factory-bot"],
		).map((a) => a.name);
	expect(reviewing("secrets: [PROBE_TOKEN]\n")).toEqual([
		"review-pull-requests",
	]);
	expect(reviewing("setup: pnpm install\n")).toEqual(["review-pull-requests"]);
	expect(reviewing("secrets: [PROBE_TOKEN]\nsetup: pnpm install\n")).toEqual(
		[],
	);
	expect(
		reviewing(
			"secrets: [PROBE_TOKEN]\ncommands:\n  test: pnpm test\nchecks: [test]\n",
		),
	).toEqual([]);
});

it("starts on a comment that mentions the word, and on no other comment", () => {
	const mentioning = loadFactory({
		...sdlcFiles(),
		"automations/rework-on-mention/automation.md":
			'---\nwhen:\n  pull_request.commented: { mentions: "@openfabriq" }\nagent: implementer\ncan: [push_to_pull_request]\n---\nDo what the comment asks.\n',
	}).factory;
	if (!mentioning) throw new Error("should load");
	const comment = (text?: string) =>
		matchingAutomations(mentioning, {
			...event({ event: "pull_request.commented", isPullRequest: true }),
			...(text === undefined ? {} : { text }),
		}).map((a) => a.name);
	expect(comment("@openfabriq add a test for an empty title")).toContain(
		"rework-on-mention",
	);
	expect(comment("Thanks, @OpenFabriq!")).toContain("rework-on-mention");
	expect(comment("thanks")).not.toContain("rework-on-mention");
	expect(comment()).not.toContain("rework-on-mention");
});

it("starts on a maintainer's comment on an issue that carries one of the labels, mention or not", () => {
	const deciding = load({
		...sdlcFiles(),
		"automations/record-decisions/automation.md":
			"---\nwhen:\n  issue.commented: { labels: [migration:decision] }\nagent: implementer\ncan: [add_comment]\n---\nRecord the answer.\n",
		"automations/answer-on-decisions/automation.md":
			'---\nwhen:\n  issue.commented: { labels: [migration:decision], mentions: "@openfabriq" }\nagent: implementer\ncan: [add_comment]\n---\nAnswer.\n',
	});
	// The fixture's triage answers every issue comment: left out here.
	const comment = (e: Partial<FactoryEvent>) =>
		matchingAutomations(
			deciding,
			event({ event: "issue.commented", text: "1", ...e }),
		)
			.map((a) => a.name)
			.filter((name) => name !== "triage-issues");
	expect(comment({ labels: ["docs", "Migration:Decision"] })).toEqual([
		"record-decisions",
	]);
	expect(
		comment({ labels: ["migration:decision"], text: "@openfabriq 2" }),
	).toEqual(["answer-on-decisions", "record-decisions"]);
	// A comment anywhere else starts nothing: each would be a billed run.
	expect(comment({ labels: ["docs"] })).toEqual([]);
	expect(comment({})).toEqual([]);
	// Only a maintainer's comment counts.
	expect(comment({ labels: ["migration:decision"], actor: "mallory" })).toEqual(
		[],
	);
	// On a labeled event, labels still mean the label just added.
	expect(
		names(
			event({
				event: "issue.labeled",
				label: "bug",
				labels: ["ready-for-agent"],
			}),
		),
	).toEqual([]);
});

it("answers a maintainer's plain comment on an issue that carries the label, and no other comment", () => {
	const answering = load({
		"factory.yaml": "name: F\nrepository: acme/app\nmaintainers: [ada]\n",
		"agents/worker/agent.md": "---\ndescription: Works\n---\nWork.\n",
		"automations/record-decisions/automation.md":
			'---\nwhen:\n  issue.commented: { labels: ["migration:decision"] }\nagent: worker\ncan: [add_comment]\n---\nRecord the answer.\n',
	});
	const answer = (e: Partial<FactoryEvent>) =>
		matchingAutomations(
			answering,
			event({ event: "issue.commented", text: "B", ...e }),
		).map((a) => a.name);
	expect(answer({ labels: ["migration:decision"] })).toEqual([
		"record-decisions",
	]);
	expect(
		answer({ labels: ["migration:decision"], text: "@openfabriq B" }),
	).toEqual(["record-decisions"]);
	expect(answer({ labels: ["migration"] })).toEqual([]);
	expect(answer({ labels: ["migration:decision"], actor: "bob" })).toEqual([]);
});

it("finds a mention as a whole word, whatever the case", () => {
	expect(mentionsWord("@openfabriq please", "@openfabriq")).toBe(true);
	expect(mentionsWord("ok\n@OPENFABRIQ: go", "@openfabriq")).toBe(true);
	expect(mentionsWord("ping @openfabriq-bot", "@openfabriq")).toBe(false);
	expect(mentionsWord("me@openfabriq.dev", "@openfabriq")).toBe(false);
	expect(mentionsWord("/factory retry", "/factory")).toBe(true);
	expect(mentionsWord(undefined, "@openfabriq")).toBe(false);
});

it("starts on a pull request opened by the agent opened_by names, and on no other", () => {
	const checking = load({
		...sdlcFiles(),
		"automations/merge-decisions/automation.md":
			"---\nwhen:\n  pull_request.opened: { opened_by: implementer }\nagent: reviewer\ncan: [add_comment]\n---\nCheck the decision.\n",
	});
	const opened = (openedBy?: string) =>
		matchingAutomations(
			checking,
			event({
				event: "pull_request.opened",
				isPullRequest: true,
				...(openedBy ? { openedBy } : {}),
			}),
		).map((a) => a.name);
	expect(opened("implementer")).toContain("merge-decisions");
	expect(opened("reviewer")).not.toContain("merge-decisions");
	// A person's pull request: no run opened it.
	expect(opened()).not.toContain("merge-decisions");
});

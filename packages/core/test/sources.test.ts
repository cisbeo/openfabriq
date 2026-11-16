import { join } from "node:path";
import { expect, it } from "vitest";
import { loadFactory } from "../src/factory/load.js";
import { workflowGraph } from "../src/graph.js";
import { type FactoryEvent, matchingAutomations } from "../src/match.js";
import { factoryLabels } from "../src/plan/labels.js";
import { planChanges } from "../src/plan/plan.js";
import { example, load, NO_FILES, ROOT, readFolder } from "./helpers.js";

// Slack and Linear as sources of runs.

/** The 03-team-chat example as it was, frozen so the template can change (Slack now files issues). */
const teamChat = () =>
	readFolder(join(ROOT, "fixtures/valid/team-chat/openfabriq"));

it("03-team-chat turns a Slack request into a GitHub issue", () => {
	const { factory, problems } = loadFactory(example("03-team-chat"));
	expect(problems).toEqual([]);
	expect(factory?.automations["answer-slack-mentions"]).toMatchObject({
		agent: "intake",
		can: [{ action: "add_comment" }, { action: "create_issue" }],
	});
	expect(factory?.agents.intake?.tools).toEqual(["read"]);
});

it("03-team-chat is valid and reads the slack and linear keys", () => {
	const { factory, problems } = loadFactory(teamChat());
	expect(problems).toEqual([]);
	expect(factory?.slack).toEqual({ channel: "factory" });
	expect(factory?.linear).toEqual({ team: "ENG" });
	expect(factory?.automations["implement-linear-issues"]?.when).toEqual([
		{ event: "linear.issue.labeled", labels: ["agent"] },
	]);
});

it("accepts a quoted #channel", () => {
	const factory = load({
		...teamChat(),
		"factory.yaml": (teamChat()["factory.yaml"] as string).replace(
			"channel: factory",
			'channel: "#factory"',
		),
	});
	expect(factory.slack).toEqual({ channel: "factory" });
});

it("refuses what a Slack or Linear run cannot do, and sources without their key", () => {
	const files = readFolder(
		join(ROOT, "fixtures/invalid/chat-sources/openfabriq"),
	);
	expect(
		loadFactory(files).problems.map((p) => `${p.file}: ${p.message}`),
	).toEqual([
		"automations/from-linear/automation.md: when linear.issue.labeled or linear.issue.delegated needs linear: { team: <key> } under integrations in factory.yaml",
		"automations/from-linear/automation.md: can.request_changes fits none of the events in when (linear.issue.labeled): only on a pull request",
		"automations/from-slack/automation.md: when.slack.mentioned does not take labels; only issue.labeled, pull_request.labeled, linear.issue.labeled, issue.commented and pull_request.commented do",
		"automations/from-slack/automation.md: when slack.mentioned needs slack: { channel: <name> } under integrations in factory.yaml",
		"automations/from-slack/automation.md: can.add_labels fits none of the events in when (slack.mentioned): a Slack message has no labels",
		"automations/from-slack/automation.md: can.push_to_pull_request fits none of the events in when (slack.mentioned): only on a pull request",
	]);
});

it("keeps the vocabulary suggestions for the new words", () => {
	const files = {
		...teamChat(),
		"automations/answer-slack-mentions/automation.md":
			"---\nwhen: slack.mention\nagent: implementer\n---\nGo.\n",
	};
	expect(loadFactory(files).problems.map((p) => p.message)).toEqual([
		'unknown event "slack.mention" in when. Did you mean "slack.mentioned"?',
	]);
});

it("lets an automation that also starts from GitHub keep its pull request rights", () => {
	const { problems } = loadFactory({
		...teamChat(),
		"automations/answer-slack-mentions/automation.md":
			'---\nwhen:\n  slack.mentioned:\n  pull_request.commented: { mentions: "@openfabriq" }\nagent: implementer\ncan: [add_comment, push_to_pull_request]\n---\nGo.\n',
	});
	expect(problems).toEqual([]);
});

it("starts Slack and Linear automations whoever acts: the gate is the channel or the team", () => {
	const factory = load(teamChat());
	const event = (e: Partial<FactoryEvent>): FactoryEvent => ({
		key: "k",
		event: "slack.mentioned",
		isPullRequest: false,
		actor: "U123",
		at: "",
		...e,
	});
	const names = (e: FactoryEvent) =>
		matchingAutomations(factory, e).map((a) => a.name);
	expect(names(event({}))).toEqual(["answer-slack-mentions"]);
	expect(
		names(
			event({ event: "linear.issue.labeled", label: "agent", actor: "Bob" }),
		),
	).toEqual(["implement-linear-issues"]);
	expect(names(event({ event: "linear.issue.labeled", label: "bug" }))).toEqual(
		[],
	);
});

it("does not ask GitHub for the labels of Linear", () => {
	expect(factoryLabels(load(teamChat()))).toEqual([
		"needs-human",
		"openfabriq:working",
	]);
});

it("creates on GitHub the labels of the issues an automation opens, whatever its source", () => {
	const files = teamChat();
	const path = "automations/investigate-sentry-errors/automation.md";
	files[path] = (files[path] as string).replace(
		"can: [create_issue, add_comment]",
		"can:\n  - create_issue: [from-sentry]\n  - add_comment",
	);
	expect(factoryLabels(load(files))).toEqual([
		"from-sentry",
		"needs-human",
		"openfabriq:working",
	]);
});

it("creates on GitHub the labels a merge waits for", () => {
	expect(
		factoryLabels(
			load({
				"factory.yaml": "name: F\nrepository: acme/app\nmaintainers: [alice]\n",
				"agents/reviewer/agent.md": "---\ndescription: Reviews\n---\nReview.\n",
				"automations/review/automation.md":
					"---\nwhen: pull_request.opened\nagent: reviewer\ncan:\n  - merge_pull_request: { labels: [merge-me] }\n---\nReview.\n",
			}),
		),
	).toEqual(["merge-me", "needs-human", "openfabriq:working"]);
});

it("flags adding or moving slack, linear and sentry as security changes", () => {
	const withPlaces = load({
		...teamChat(),
		"factory.yaml":
			"name: F\nrepository: acme/web-app\nmaintainers: [alice]\nintegrations:\n  slack:\n    channel: factory\n  linear:\n    team: ENG\n  sentry:\n    organization: acme\n    project: web-app\n",
	});
	const before = load({
		"factory.yaml": "name: F\nrepository: acme/web-app\nmaintainers: [alice]\n",
		"agents/implementer/agent.md": teamChat()[
			"agents/implementer/agent.md"
		] as string,
		"automations/x/automation.md":
			"---\nwhen: issue.opened\nagent: implementer\n---\nGo.\n",
	});
	expect(
		planChanges(before, withPlaces, [], NO_FILES).security.slice(0, 3),
	).toEqual([
		'+ slack: channel #factory; people in the channel can now start automations, through the relay ("openfabriq connect slack")',
		'+ linear: team ENG; people of the team can now start automations, through the relay ("openfabriq connect linear")',
		'+ sentry: project acme/web-app; its new issues can now start automations, through the relay ("openfabriq connect sentry")',
	]);
	const selfHosted = load({
		...teamChat(),
		"factory.yaml": (teamChat()["factory.yaml"] as string).replace(
			"project: web-app",
			"project: web-app\n    url: https://sentry.acme.dev/",
		),
	});
	expect(selfHosted.sentry).toEqual({
		organization: "acme",
		project: "web-app",
		url: "https://sentry.acme.dev",
	});
	expect(
		planChanges(load(teamChat()), selfHosted, [], NO_FILES).security,
	).toEqual([
		"~ sentry: project acme/web-app → project acme/web-app on https://sentry.acme.dev; its new issues can now start automations",
	]);
	const moved = load({
		...teamChat(),
		"factory.yaml": (teamChat()["factory.yaml"] as string).replace(
			"channel: factory",
			"channel: general",
		),
	});
	expect(planChanges(load(teamChat()), moved, [], NO_FILES).security).toEqual([
		"~ slack: channel #factory → channel #general; people in the channel can now start automations",
	]);
});

it("draws Slack and Linear as entry points of the workflow", () => {
	const g = workflowGraph(load(teamChat()));
	const node = (id: string) => g.nodes.find((n) => n.id === id);
	expect(node("event:slack.mentioned")).toEqual({
		id: "event:slack.mentioned",
		kind: "event",
		title: "slack.mentioned",
		entry: true,
		source: "slack",
	});
	expect(node("event:linear.issue.labeled:agent")).toMatchObject({
		entry: true,
		source: "linear",
	});
	// add_labels on a Linear run labels the Linear issue: needs-info is where the work leaves.
	expect(node("event:linear.issue.labeled:needs-info")).toMatchObject({
		end: true,
		source: "linear",
	});
	expect(g.edges.map((e) => e.id)).toContain(
		"automation:implement-linear-issues→event:linear.issue.labeled:needs-info",
	);
});

it("reads a Sentry trigger and its query, and refuses what a Sentry run cannot do", () => {
	const factory = load(teamChat());
	expect(factory.automations["investigate-sentry-errors"]?.when).toEqual([
		{
			event: "sentry.issue.created",
			query: "level:error environment:production",
		},
	]);
	const files = {
		...teamChat(),
		"factory.yaml": (teamChat()["factory.yaml"] as string).replace(
			/ {2}sentry:\n.*\n.*\n/,
			"",
		),
		"automations/investigate-sentry-errors/automation.md":
			'---\nwhen:\n  sentry.issue.created: { query: "level:error" }\n  pull_request.opened: { query: "x" }\nagent: investigator\ncan: [create_issue]\n---\nGo.\n',
		"automations/noisy/automation.md":
			"---\nwhen: [sentry.issue.created, slack.mentioned]\nagent: investigator\ncan:\n  - add_labels: [bug]\n  - request_changes\n---\nGo.\n",
	};
	expect(
		loadFactory(files).problems.map((p) => `${p.file}: ${p.message}`),
	).toEqual([
		"automations/investigate-sentry-errors/automation.md: when.pull_request.opened does not take a query; only sentry.issue.created does",
		"automations/investigate-sentry-errors/automation.md: when sentry.issue.created needs sentry: { organization: <slug>, project: <slug> } under integrations in factory.yaml",
		"automations/noisy/automation.md: when sentry.issue.created needs sentry: { organization: <slug>, project: <slug> } under integrations in factory.yaml",
		"automations/noisy/automation.md: can.add_labels fits none of the events in when (sentry.issue.created, slack.mentioned): a Sentry issue has no labels; a Slack message has no labels",
		"automations/noisy/automation.md: can.request_changes fits none of the events in when (sentry.issue.created, slack.mentioned): only on a pull request",
	]);
});

it("matches a Sentry event to the trigger whose query found it, whoever caused the error", () => {
	const factory = load({
		...teamChat(),
		"automations/count-noisy-errors/automation.md":
			'---\nwhen:\n  sentry.issue.created: { query: "times_seen:>50" }\nagent: investigator\ncan: [create_issue]\n---\nGo.\n',
	});
	const event = (query?: string): FactoryEvent => ({
		key: "k",
		event: "sentry.issue.created",
		isPullRequest: false,
		actor: "sentry",
		at: "",
		...(query ? { query } : {}),
	});
	const names = (e: FactoryEvent) =>
		matchingAutomations(factory, e).map((a) => a.name);
	expect(names(event("level:error environment:production"))).toEqual([
		"investigate-sentry-errors",
	]);
	expect(names(event("times_seen:>50"))).toEqual(["count-noisy-errors"]);
	expect(names(event())).toEqual([]);
});

it("draws Sentry as an entry point, with its query", () => {
	const g = workflowGraph(load(teamChat()));
	expect(g.nodes.find((n) => n.title === "sentry.issue.created")).toEqual({
		id: "event:sentry.issue.created:level:error environment:production",
		kind: "event",
		title: "sentry.issue.created",
		detail: "level:error environment:production",
		entry: true,
		source: "sentry",
	});
	// create_issue produces issue.opened, which nothing in this example listens to.
	expect(g.edges.map((e) => e.id)).toContain(
		"automation:investigate-sentry-errors→event:issue.opened",
	);
});

it("a Linear issue handed to openfabriq starts an automation, through the relay", () => {
	const factory = load(teamChat());
	expect(
		factory.automations["implement-delegated-linear-issues"]?.when,
	).toEqual([{ event: "linear.issue.delegated" }]);
	const pushing = loadFactory({
		...teamChat(),
		"automations/implement-delegated-linear-issues/automation.md":
			"---\nwhen: linear.issue.delegated\nagent: implementer\ncan: [push_to_pull_request]\n---\nPush.\n",
	});
	expect(pushing.problems.map((p) => p.message)).toEqual([
		"can.push_to_pull_request fits none of the events in when (linear.issue.delegated): only on a pull request",
	]);
	const files = teamChat();
	delete files["automations/implement-delegated-linear-issues/automation.md"];
	const plan = planChanges(load(files), factory, [], {
		before: files,
		after: teamChat(),
	});
	expect(plan.security).toContain(
		'+ automation implement-delegated-linear-issues starts when someone of the Linear team hands an issue to openfabriq; it arrives through the relay ("openfabriq connect relay") and needs openfabriq installed in Linear as an agent ("openfabriq connect linear")',
	);
});

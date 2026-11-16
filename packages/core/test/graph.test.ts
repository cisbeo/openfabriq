import { join } from "node:path";
import { expect, it } from "vitest";
import { loadFactory } from "../src/factory/load.js";
import type { FactoryFiles } from "../src/factory/types.js";
import { agentOrder, type WorkflowGraph, workflowGraph } from "../src/graph.js";
import { ROOT, readFolder, sdlcFiles } from "./helpers.js";

function graph(files: FactoryFiles): WorkflowGraph {
	const { factory, problems } = loadFactory(files);
	if (!factory) throw new Error(JSON.stringify(problems));
	return workflowGraph(factory);
}
const edges = (g: WorkflowGraph) =>
	g.edges.map(
		(e) => `${e.source} → ${e.target}${e.label ? ` (${e.label})` : ""}`,
	);
const ids = (
	g: WorkflowGraph,
	pick: (n: WorkflowGraph["nodes"][number]) => boolean,
) => g.nodes.filter(pick).map((n) => n.id);

it("chains the sdlc automations through the events they produce", () => {
	const g = graph(sdlcFiles());
	expect(edges(g)).toEqual(
		expect.arrayContaining([
			"event:issue.opened → automation:triage-issues",
			"automation:triage-issues → event:issue.labeled:ready-for-agent (add_labels)",
			"event:issue.labeled:ready-for-agent → automation:implement-ready-issues",
			"automation:implement-ready-issues → event:pull_request.opened (create_pull_request)",
			"event:pull_request.opened → automation:review-pull-requests",
			"automation:review-pull-requests → event:pull_request.changes_requested (request_changes)",
			"event:pull_request.changes_requested → automation:rework-pull-requests",
			"automation:rework-pull-requests → event:pull_request.updated (push_to_pull_request)",
			"event:pull_request.updated → automation:review-pull-requests",
			"automation:investigate-bugs → event:issue.labeled:ready-for-agent (add_labels)",
		]),
	);
	// Comments and removed labels start nothing, so they draw no arrow.
	expect(
		edges(g).filter(
			(e) => e.includes("add_comment") || e.includes("remove_labels"),
		),
	).toEqual([]);
	expect(ids(g, (n) => n.entry === true)).toEqual([
		"event:issue.commented",
		"event:issue.opened",
	]);
	expect(ids(g, (n) => n.end === true)).toEqual([
		"event:issue.labeled:needs-human",
		"event:issue.labeled:needs-info",
		"event:pull_request.labeled:needs-human",
	]);
	expect(
		g.nodes.find((n) => n.id === "automation:implement-ready-issues"),
	).toEqual({
		id: "automation:implement-ready-issues",
		kind: "automation",
		title: "implement-ready-issues",
		detail: "implementer",
		can: [
			"create_pull_request",
			"add_comment",
			"remove_labels (ready-for-agent)",
			"add_labels (needs-info)",
		],
	});
	expect(
		g.nodes.find((n) => n.id === "event:issue.labeled:ready-for-agent"),
	).toEqual({
		id: "event:issue.labeled:ready-for-agent",
		kind: "event",
		title: "issue.labeled",
		detail: "ready-for-agent",
	});
});

it("links a label added freely to every automation started by a label, and keeps schedules apart", () => {
	const g = graph({
		"factory.yaml": "name: F\nrepository: acme/app\nmaintainers: [alice]\n",
		"agents/worker/agent.md": "---\ndescription: Does things\n---\nDo.\n",
		"automations/sort/automation.md":
			"---\nwhen: pull_request.opened\nagent: worker\ncan: [add_labels]\n---\nSort.\n",
		"automations/ship/automation.md":
			"---\nwhen:\n  pull_request.labeled: { labels: [ship] }\nagent: worker\n---\nShip.\n",
		"automations/nightly/automation.md":
			'---\nwhen:\n  schedule: { cron: "0 3 * * *" }\nagent: worker\ncan: [create_issue]\n---\nCheck.\n',
	});
	expect(edges(g)).toEqual([
		"automation:nightly → event:issue.opened (create_issue)",
		"automation:sort → event:pull_request.labeled (add_labels)",
		"event:pull_request.labeled:ship → automation:ship",
		"event:pull_request.labeled → automation:ship",
		"event:pull_request.opened → automation:sort",
		"event:schedule:0 3 * * * → automation:nightly",
	]);
	expect(
		g.nodes.find((n) => n.id === "event:pull_request.labeled")?.detail,
	).toBe("any label");
	expect(g.nodes.find((n) => n.id === "event:schedule:0 3 * * *")?.detail).toBe(
		"0 3 * * *",
	);
});

it("links the labels an automation puts on the issues it opens to the automations that listen to them", () => {
	const g = graph({
		"factory.yaml": "name: F\nrepository: acme/app\nmaintainers: [alice]\n",
		"agents/worker/agent.md": "---\ndescription: Does things\n---\nDo.\n",
		"automations/map/automation.md":
			'---\nwhen:\n  schedule: { cron: "0 6 * * 1" }\nagent: worker\ncan:\n  - create_issue: [unit]\n---\nMap.\n',
		"automations/hunt/automation.md":
			"---\nwhen:\n  issue.labeled: { labels: [unit] }\nagent: worker\n---\nHunt.\n",
	});
	expect(edges(g)).toEqual([
		"automation:map → event:issue.labeled:unit (create_issue)",
		"automation:map → event:issue.opened (create_issue)",
		"event:issue.labeled:unit → automation:hunt",
		"event:schedule:0 6 * * 1 → automation:map",
	]);
});

it("links the labels an automation puts on the pull requests it opens, as it does for issues", () => {
	const g = graph({
		"factory.yaml": "name: F\nrepository: acme/app\nmaintainers: [alice]\n",
		"agents/worker/agent.md": "---\ndescription: Does things\n---\nDo.\n",
		"automations/plan/automation.md":
			"---\nwhen: issue.opened\nagent: worker\ncan:\n  - create_pull_request: [needs-human]\n---\nPlan.\n",
	});
	expect(edges(g)).toContain(
		"automation:plan → event:pull_request.labeled:needs-human (create_pull_request)",
	);
});

it("links a label to the automation that listens to it, whatever its case", () => {
	const g = graph({
		"factory.yaml": "name: F\nrepository: acme/app\nmaintainers: [alice]\n",
		"agents/worker/agent.md": "---\ndescription: Does things\n---\nDo.\n",
		"automations/sort/automation.md":
			"---\nwhen: issue.opened\nagent: worker\ncan:\n  - add_labels: [Ready]\n---\nSort.\n",
		"automations/build/automation.md":
			"---\nwhen:\n  issue.labeled: { labels: [ready] }\nagent: worker\n---\nBuild.\n",
	});
	expect(edges(g)).toContain("event:issue.labeled:Ready → automation:build");
});

it("orders agents as the work reaches them, then by name", () => {
	const factory = loadFactory(sdlcFiles()).factory;
	if (!factory) throw new Error("the sdlc fixture should load");
	expect(agentOrder(factory)).toEqual([
		"triage",
		"implementer",
		"investigator",
		"reviewer",
		"rework",
	]);
});

it("draws the review loop of an automation reviewed before its pull request, and orders its reviewer after it", () => {
	const files: FactoryFiles = {
		"factory.yaml": "name: F\nrepository: acme/app\nmaintainers: [ada]\n",
		"agents/implementer/agent.md":
			"---\ndescription: Implements\ntools: [read, edit, shell]\n---\nDo.\n",
		"agents/checker/agent.md":
			"---\ndescription: Reviews\ntools: [read, shell]\n---\nReview.\n",
		"automations/implement/automation.md":
			"---\nwhen:\n  issue.labeled: { labels: [ready] }\nagent: implementer\nreviewed_by: checker\ncan: [create_pull_request]\n---\nGo.\n",
	};
	const g = graph(files);
	expect(g.nodes.find((n) => n.id === "review:implement")).toEqual({
		id: "review:implement",
		kind: "review",
		title: "implement",
		detail: "checker",
	});
	expect(edges(g)).toEqual(
		expect.arrayContaining([
			"automation:implement → review:implement (its change)",
			"review:implement → automation:implement (needs changes)",
		]),
	);
	const factory = loadFactory(files).factory;
	if (!factory) throw new Error("should load");
	expect(agentOrder(factory)).toEqual(["implementer", "checker"]);
});

it("links the labels an internal review puts to the automations that listen to them, and draws no others", () => {
	const files: FactoryFiles = {
		"factory.yaml": "name: F\nrepository: acme/app\nmaintainers: [ada]\n",
		"agents/implementer/agent.md":
			"---\ndescription: Implements\ntools: [read, edit, shell]\n---\nDo.\n",
		"agents/checker/agent.md":
			"---\ndescription: Reviews\ntools: [read]\n---\nReview.\n",
		"automations/implement/automation.md":
			"---\nwhen:\n  issue.labeled: { labels: [ready] }\nagent: implementer\nreviewed_by: checker\ncan: [create_pull_request]\n---\nGo.\n",
	};
	// Nothing listens to them: no box for each review label.
	expect(ids(graph(files), (n) => n.title === "pull_request.labeled")).toEqual(
		[],
	);
	const g = graph({
		...files,
		"automations/announce/automation.md":
			"---\nwhen:\n  pull_request.labeled: { labels: [risk:low] }\nagent: checker\ncan: [add_comment]\n---\nSay it.\n",
	});
	expect(edges(g)).toEqual(
		expect.arrayContaining([
			"automation:implement → event:pull_request.labeled:risk:low (create_pull_request)",
			"event:pull_request.labeled:risk:low → automation:announce",
		]),
	);
	expect(ids(g, (n) => n.title === "pull_request.labeled")).toEqual([
		"event:pull_request.labeled:risk:low",
	]);
	// Started by the engine's label, not by a person.
	expect(
		g.nodes.find((n) => n.id === "event:pull_request.labeled:risk:low")?.entry,
	).toBeUndefined(); // Any label, or another case: the engine's label starts them too, so they are linked.
	const loose = graph({
		...files,
		"automations/any-label/automation.md":
			"---\nwhen: pull_request.labeled\nagent: checker\ncan: [add_comment]\n---\nSay it.\n",
		"automations/upper/automation.md":
			"---\nwhen:\n  pull_request.labeled: { labels: [Risk:High] }\nagent: checker\ncan: [add_comment]\n---\nSay it.\n",
	});
	expect(edges(loose)).toEqual(
		expect.arrayContaining([
			"automation:implement → event:pull_request.labeled:risk:high (create_pull_request)",
			"event:pull_request.labeled:risk:high → automation:any-label",
			"event:pull_request.labeled:risk:high → automation:upper",
		]),
	);
});

it("links a comment that mentions the word to its automation, and a plain comment only to the others", () => {
	const g = graph({
		...sdlcFiles(),
		"automations/rework-on-mention/automation.md":
			'---\nwhen:\n  pull_request.commented: { mentions: "@openfabriq" }\nagent: implementer\ncan: [push_to_pull_request]\n---\nDo what the comment asks.\n',
	});
	const mention = g.nodes.find(
		(n) => n.id === "event:pull_request.commented:@openfabriq",
	);
	expect(mention?.detail).toBe("mentions @openfabriq");
	expect(edges(g)).toContain(
		"event:pull_request.commented:@openfabriq → automation:rework-on-mention",
	);
	expect(edges(g)).not.toContain(
		"event:pull_request.commented → automation:rework-on-mention",
	);
});

it("draws a comment on a labeled issue as its own start, linked only to the automations that filter on that label", () => {
	const g = graph({
		...sdlcFiles(),
		"automations/record-decisions/automation.md":
			"---\nwhen:\n  issue.commented: { labels: [migration:decision] }\nagent: implementer\ncan: [add_comment]\n---\nRecord.\n",
		"automations/answer-decisions/automation.md":
			'---\nwhen:\n  issue.commented: { labels: [migration:decision], mentions: "@openfabriq" }\nagent: implementer\ncan: [add_comment]\n---\nAnswer.\n',
		"automations/any-comment/automation.md":
			"---\nwhen: issue.commented\nagent: implementer\ncan: [add_comment]\n---\nAny.\n",
	});
	const decision = g.nodes.find(
		(n) => n.id === "event:issue.commented:migration:decision",
	);
	expect(decision?.detail).toBe("labeled migration:decision");
	expect(decision?.entry).toBe(true);
	expect(
		g.nodes.find(
			(n) => n.id === "event:issue.commented:migration:decision:@openfabriq",
		)?.detail,
	).toBe("labeled migration:decision, mentions @openfabriq");
	const into = (automation: string) =>
		edges(g)
			.filter((e) => e.endsWith(`automation:${automation}`))
			.map((e) => e.split(" → ")[0])
			.sort();
	expect(into("record-decisions")).toEqual([
		"event:issue.commented:migration:decision",
		"event:issue.commented:migration:decision:@openfabriq",
	]);
	expect(into("answer-decisions")).toEqual([
		"event:issue.commented:migration:decision:@openfabriq",
	]);
	expect(into("any-comment")).toEqual([
		"event:issue.commented",
		"event:issue.commented:migration:decision",
		"event:issue.commented:migration:decision:@openfabriq",
	]);
});

it("draws every event and automation once, in id order, with what it knows of each", () => {
	const g = graph({
		"factory.yaml":
			"name: F\nrepository: acme/app\nmaintainers: [alice]\nwebhooks:\n  deploy:\n    signature: standard\n",
		"agents/worker/agent.md": "---\ndescription: Does things\n---\nDo.\n",
		"automations/fix/automation.md":
			"---\nwhen: issue.commented\nagent: worker\nfrom: anyone\ncan:\n  - add_labels: [x]\n  - create_issue: [x]\n---\nFix.\n",
		"automations/deploy/automation.md":
			"---\nwhen:\n  webhook.received: { webhook: deploy }\nagent: worker\ncan: [create_issue]\n---\nDeploy.\n",
		"automations/hunt/automation.md":
			"---\nwhen:\n  issue.labeled: { labels: [x] }\nagent: worker\n---\nHunt.\n",
	});
	// The first permission that produces an event names its arrow.
	expect(g.edges).toStrictEqual([
		{
			id: "automation:deploy→event:issue.opened",
			source: "automation:deploy",
			target: "event:issue.opened",
			label: "create_issue",
		},
		{
			id: "automation:fix→event:issue.labeled:x",
			source: "automation:fix",
			target: "event:issue.labeled:x",
			label: "add_labels",
		},
		{
			id: "automation:fix→event:issue.opened",
			source: "automation:fix",
			target: "event:issue.opened",
			label: "create_issue",
		},
		{
			id: "event:issue.commented→automation:fix",
			source: "event:issue.commented",
			target: "automation:fix",
		},
		{
			id: "event:issue.labeled:x→automation:hunt",
			source: "event:issue.labeled:x",
			target: "automation:hunt",
		},
		{
			id: "event:webhook.received:deploy→automation:deploy",
			source: "event:webhook.received:deploy",
			target: "automation:deploy",
		},
	]);
	expect(g.nodes).toStrictEqual([
		{
			id: "event:issue.commented",
			kind: "event",
			title: "issue.commented",
			entry: true,
		},
		{
			id: "event:issue.labeled:x",
			kind: "event",
			title: "issue.labeled",
			detail: "x",
		},
		{
			id: "event:issue.opened",
			kind: "event",
			title: "issue.opened",
			end: true,
		},
		{
			id: "event:webhook.received:deploy",
			kind: "event",
			title: "webhook.received",
			detail: "deploy",
			entry: true,
			source: "webhook",
		},
		{
			id: "automation:deploy",
			kind: "automation",
			title: "deploy",
			detail: "worker",
			can: ["create_issue"],
		},
		{
			id: "automation:fix",
			kind: "automation",
			title: "fix",
			detail: "worker",
			can: ["add_labels (x)", "create_issue (x)"],
			anyone: true,
		},
		{
			id: "automation:hunt",
			kind: "automation",
			title: "hunt",
			detail: "worker",
			can: [],
		},
	]);
});

it("says the area of each automation of a factory ordered by area", () => {
	const g = graph(readFolder(join(ROOT, "fixtures/valid/areas/openfabriq")));
	const areaOf = (id: string) => g.nodes.find((n) => n.id === id)?.area;
	expect(areaOf("automation:test-new-prs")).toBe("qa");
	expect(areaOf("automation:nightly-audit")).toBe("security");
	expect(areaOf("automation:triage-issues")).toBeUndefined();
	expect(areaOf("event:pull_request.opened")).toBeUndefined();
});

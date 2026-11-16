import type { WorkflowGraph, WorkflowNode } from "@openfabriq/core";
import { describe, expect, it } from "vitest";
import {
	comesNext,
	edgesFrom,
	edgesInto,
	eventSentence,
	eventWords,
	originWords,
	permission,
	roleOf,
} from "../../../app/src/features/workflow/graph-words.js";

const event = (over: Partial<WorkflowNode>): WorkflowNode => ({
	id: "e",
	kind: "event",
	title: "issue.labeled",
	...over,
});

it("reads a permission's action and its labels", () => {
	expect(permission("add_labels (ready-for-agent, needs-info)")).toEqual({
		action: "add_labels",
		labels: ["ready-for-agent", "needs-info"],
	});
	expect(
		permission(
			"merge_pull_request (labels risk:low; paths docs/**, src/content/**)",
		),
	).toEqual({
		action: "merge_pull_request",
		labels: ["labels risk:low", "paths docs/**, src/content/**"],
	});
	expect(permission("add_comment")).toEqual({
		action: "add_comment",
		labels: [],
	});
	expect(permission("not a permission!")).toEqual({
		action: "not a permission!",
		labels: [],
	});
});

it("tells where work starts, where it reaches a person, and where it leaves", () => {
	expect(roleOf(event({ entry: true }))).toBe("start");
	expect(roleOf(event({ end: true, detail: "needs-human" }))).toBe("you");
	expect(roleOf(event({ end: true, detail: "needs-info" }))).toBe("out");
	expect(roleOf(event({}))).toBe("pass");
});

it("names an event in a few words and in a sentence", () => {
	const labeled = event({ detail: "ready-for-agent" });
	expect(eventWords(labeled)).toBe("Issue labeled · ready-for-agent");
	expect(eventSentence(labeled)).toBe("An issue is labeled (ready-for-agent).");
	expect(eventSentence(event({ detail: "any label" }))).toBe(
		"An issue is labeled.",
	);
	expect(eventWords(event({ title: "schedule" }))).toBe("Schedule");
});

it("says who causes an event nothing in the factory produces", () => {
	expect(originWords(event({ source: "slack" }))).toBe(
		"Someone in Slack. Nothing in the factory produces it: work starts here.",
	);
	expect(originWords(event({ title: "schedule" }))).toBe(
		"The clock. Nothing in the factory produces it: work starts here.",
	);
	expect(originWords(event({}))).toBe(
		"A person, or GitHub. Nothing in the factory produces it: work starts here.",
	);
});

describe("the arrows around a box", () => {
	const automation = (id: string): WorkflowNode => ({
		id,
		kind: "automation",
		title: id,
	});
	// triage writes "ready" (implement listens) and "needs-info" (nobody does).
	const graph: WorkflowGraph = {
		nodes: [
			event({ id: "opened", entry: true }),
			automation("triage"),
			event({ id: "ready" }),
			event({ id: "needs-info", end: true }),
			automation("implement"),
			automation("document"),
		],
		edges: [
			{ id: "1", source: "opened", target: "triage" },
			{ id: "2", source: "triage", target: "ready", label: "add_labels" },
			{ id: "3", source: "triage", target: "needs-info" },
			{ id: "4", source: "ready", target: "implement" },
			{ id: "5", source: "ready", target: "document" },
		],
	};

	it("finds the arrows into and out of a box", () => {
		expect(edgesInto(graph, "ready").map((e) => e.id)).toEqual(["2"]);
		expect(edgesFrom(graph, "triage").map((e) => e.id)).toEqual(["2", "3"]);
		expect(edgesFrom(graph, "needs-info")).toEqual([]);
	});

	it("says what comes after an automation: the next automations, then where the work ends", () => {
		expect(comesNext(graph, "triage")).toEqual([
			"implement",
			"document",
			"needs-info",
		]);
		expect(comesNext(graph, "implement")).toEqual([]);
	});
});

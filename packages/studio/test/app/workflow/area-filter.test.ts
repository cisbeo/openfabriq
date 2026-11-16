import type { WorkflowGraph, WorkflowNode } from "@openfabriq/core";
import { expect, it } from "vitest";
import {
	areasIn,
	areaView,
} from "../../../app/src/features/workflow/area-filter.js";

const automation = (name: string, area?: string): WorkflowNode => ({
	id: `automation:${name}`,
	kind: "automation",
	title: name,
	...(area ? { area } : {}),
});
const event = (name: string): WorkflowNode => ({
	id: `event:${name}`,
	kind: "event",
	title: name,
});
const edge = (source: string, target: string) => ({
	id: `${source}->${target}`,
	source,
	target,
});

// issue.opened → triage (root) → ready → test (qa) → tested → review (review) → reviewed;
// audit (security) stands apart.
const graph: WorkflowGraph = {
	nodes: [
		event("issue.opened"),
		automation("triage"),
		event("ready"),
		automation("test", "qa"),
		event("tested"),
		automation("review", "review"),
		event("reviewed"),
		event("schedule"),
		automation("audit", "security"),
		// Also writes what qa writes, and listens to what qa listens to: beside qa, not on its path.
		automation("bump", "maintenance"),
	],
	edges: [
		edge("event:issue.opened", "automation:triage"),
		edge("automation:triage", "event:ready"),
		edge("event:ready", "automation:test"),
		edge("automation:test", "event:tested"),
		edge("event:tested", "automation:review"),
		edge("automation:review", "event:reviewed"),
		edge("event:schedule", "automation:audit"),
		edge("event:ready", "automation:bump"),
		edge("automation:bump", "event:tested"),
	],
};

it("lists the areas of the graph by name, none for a factory without", () => {
	expect(areasIn(graph)).toEqual(["maintenance", "qa", "review", "security"]);
	expect(areasIn({ nodes: [automation("a"), event("e")], edges: [] })).toEqual(
		[],
	);
});

it("keeps an area's automations and their events, fades those the work comes from or goes on to, and hides the rest", () => {
	const view = areaView(graph, "qa");
	expect(view.graph.nodes.map((n) => n.id)).toEqual([
		"automation:triage",
		"event:ready",
		"automation:test",
		"event:tested",
		"automation:review",
	]);
	expect([...view.faded].sort()).toEqual([
		"automation:review",
		"automation:triage",
	]);
	expect(view.graph.edges.map((e) => e.id)).toEqual([
		"automation:triage->event:ready",
		"event:ready->automation:test",
		"automation:test->event:tested",
		"event:tested->automation:review",
	]);
});

it("shows the whole graph without an area, or with one it does not have", () => {
	for (const area of [undefined, "ops"]) {
		const view = areaView(graph, area);
		expect(view.graph).toBe(graph);
		expect(view.faded.size).toBe(0);
	}
});

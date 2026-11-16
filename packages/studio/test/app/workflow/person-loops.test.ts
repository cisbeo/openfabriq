import { join } from "node:path";
import {
	loadFactory,
	withAnswerMentions,
	workflowGraph,
} from "@openfabriq/core";
import { readFactoryFolder } from "@openfabriq/runner";
import { expect, it } from "vitest";
import { personLoops } from "../../../app/src/features/workflow/person-loops.js";
import { foldEndLabels } from "../../../src/workflow/fold-end-labels.js";

const graphOf = (example: string) => {
	const { factory } = loadFactory(
		readFactoryFolder(
			join(import.meta.dirname, `../../../../../${example}/openfabriq`),
		),
	);
	if (!factory) throw new Error(`${example} does not load`);
	// As the engine runs it: with its answer to mentions.
	return workflowGraph(withAnswerMentions(factory));
};

it("brings a question back to the automation that listens to the answer", () => {
	expect(personLoops(graphOf("fixtures/valid/sdlc"))).toEqual([
		{
			id: "event:issue.labeled:needs-info↺event:issue.commented",
			source: "event:issue.labeled:needs-info",
			target: "event:issue.commented",
			who: "a maintainer",
			automations: ["triage-issues"],
		},
	]);
});

it("brings a pull request back to the automation that listens to a mention of the factory, native here", () => {
	const loops = personLoops(graphOf("examples/01-quickstart"));
	expect(loops.map((l) => [l.source, l.target, l.automations])).toEqual([
		[
			"event:pull_request.opened",
			"event:pull_request.commented:@openfabriq",
			["answer-mentions-implementer"],
		],
		[
			"event:pull_request.updated",
			"event:pull_request.commented:@openfabriq",
			["answer-mentions-implementer"],
		],
	]);
});

it("folds the labels one automation adds that nothing listens to into one box, with one loop per kind of subject", () => {
	const graph = foldEndLabels(graphOf("examples/02-sdlc"));
	const labeled = graph.nodes.filter(
		(n) => n.kind === "event" && n.title === "issue.labeled" && n.end,
	);
	expect(labeled.map((n) => n.detail)).toEqual([
		"needs-human",
		"bug, chore, docs, feature, needs-info",
	]);
	const loops = personLoops(graph);
	// The pull requests, reviewed before they open, wait for a person, whose mention sends the implementer back.
	expect(loops.map((l) => [l.source, l.automations])).toEqual([
		["event:pull_request.opened", ["answer-mentions"]],
		["event:pull_request.updated", ["answer-mentions"]],
		["event:issue.labeled:waiting", ["triage-issues"]],
	]);
	// needs-info is added by the implementer too: both point to the box.
	expect(
		graph.edges
			.filter((e) => e.target === loops[2]?.source)
			.map((e) => e.source),
	).toEqual(["automation:implement-ready-issues", "automation:triage-issues"]);
	// Every edge still ends on a box.
	const ids = new Set(graph.nodes.map((n) => n.id));
	expect(graph.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(
		true,
	);
});

it("leaves a graph without such labels as it is", () => {
	const graph = graphOf("fixtures/valid/sdlc");
	expect(foldEndLabels(graph)).toBe(graph);
});

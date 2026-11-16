import {
	HANDOFF_LABEL,
	type WorkflowEdge,
	type WorkflowGraph,
	type WorkflowNode,
} from "@openfabriq/core";

/**
 * The labels nothing listens to, as one box per kind of subject. A triage that tags the
 * kind of work (bug, feature, docs…) beside needs-info would otherwise draw a box and a
 * "maintainer answers" loop for each: they all wait for the same person. The box keeps an
 * arrow from every automation that adds one of them; the handoff label keeps its own box.
 */
export function foldEndLabels(graph: WorkflowGraph): WorkflowGraph {
	const groups = new Map<string, WorkflowNode[]>();
	for (const n of graph.nodes) {
		if (
			n.kind !== "event" ||
			!n.end ||
			!n.title.endsWith(".labeled") ||
			!n.detail ||
			n.detail === HANDOFF_LABEL
		)
			continue;
		groups.set(n.title, [...(groups.get(n.title) ?? []), n]);
	}
	const folded = new Map<string, string>();
	const added: WorkflowNode[] = [];
	for (const [key, nodes] of groups) {
		const [first] = nodes;
		if (!first || nodes.length < 2) continue;
		const id = `event:${key}:waiting`;
		for (const n of nodes) folded.set(n.id, id);
		const { detail: _, ...rest } = first;
		added.push({
			...rest,
			id,
			detail: nodes.map((n) => n.detail).join(", "),
		});
	}
	if (folded.size === 0) return graph;
	const edges = new Map<string, WorkflowEdge>();
	for (const e of graph.edges) {
		const target = folded.get(e.target) ?? e.target;
		const id = `${e.source}→${target}`;
		if (!edges.has(id)) edges.set(id, { ...e, id, target });
	}
	return {
		nodes: [...graph.nodes.filter((n) => !folded.has(n.id)), ...added],
		edges: [...edges.values()],
	};
}

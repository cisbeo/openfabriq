import type { WorkflowGraph } from "@openfabriq/core";

/** The areas of the factory's automations, by name; none when the factory has none. */
export function areasIn(graph: WorkflowGraph): string[] {
	return [
		...new Set(graph.nodes.flatMap((n) => (n.area ? [n.area] : []))),
	].sort();
}

/**
 * The graph seen from one area: its automations and the events they listen to or produce; faded,
 * the automations of elsewhere that produce what it listens to (the work comes from them) or listen
 * to what it produces (the work goes on there); and the arrows between those. Not the automations
 * beside it, that listen to or produce the same events. The whole graph without an area, or for
 * one it does not have.
 */
export function areaView(
	graph: WorkflowGraph,
	area: string | undefined,
): { graph: WorkflowGraph; faded: Set<string> } {
	const own = new Set(
		graph.nodes.filter((n) => area && n.area === area).map((n) => n.id),
	);
	if (own.size === 0) return { graph, faded: new Set() };
	const after = (ids: Set<string>) =>
		new Set(graph.edges.filter((e) => ids.has(e.source)).map((e) => e.target));
	const before = (ids: Set<string>) =>
		new Set(graph.edges.filter((e) => ids.has(e.target)).map((e) => e.source));
	const produced = after(own);
	const listened = before(own);
	const faded = new Set(
		[...after(produced), ...before(listened)].filter((id) => !own.has(id)),
	);
	const kept = new Set([...own, ...produced, ...listened, ...faded]);
	return {
		graph: {
			nodes: graph.nodes.filter((n) => kept.has(n.id)),
			edges: graph.edges.filter(
				(e) => kept.has(e.source) && kept.has(e.target),
			),
		},
		faded,
	};
}

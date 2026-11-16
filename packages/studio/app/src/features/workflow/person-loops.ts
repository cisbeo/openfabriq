import { HANDOFF_LABEL, type WorkflowGraph } from "@openfabriq/core";

/** Where the work leaves the factory and comes back when a person answers with a comment. */
export interface PersonLoop {
	id: string;
	/** The event no automation listens to ("Issue labeled · needs-info"). */
	source: string;
	/** The comment event that starts the work again. */
	target: string;
	/** Who must write the comment for it to count. */
	who: "a maintainer" | "anyone";
	/** The automations the comment starts again. */
	automations: string[];
}

const COMMENT: Record<string, string> = {
	issue: "issue.commented",
	pull_request: "pull_request.commented",
};

/**
 * A label that nothing listens to waits for a person; when that person comments on the
 * same issue or pull request, the automations that listen to comments start again. The
 * graph cannot see it, since a person makes that event. The handoff label is the end
 * of the work, not a question: it starts no loop.
 */
export function personLoops(graph: WorkflowGraph): PersonLoop[] {
	const byId = new Map(graph.nodes.map((n) => [n.id, n]));
	return graph.nodes.flatMap((n) => {
		if (n.kind !== "event" || !n.end || n.detail === HANDOFF_LABEL) return [];
		const comment = COMMENT[n.title.split(".")[0] ?? ""];
		const target = graph.nodes.find(
			(e) => e.kind === "event" && e.title === comment,
		);
		if (!target) return [];
		const listeners = graph.edges
			.filter((e) => e.source === target.id)
			.map((e) => byId.get(e.target))
			.filter((a) => a?.kind === "automation");
		if (listeners.length === 0) return [];
		return [
			{
				id: `${n.id}↺${target.id}`,
				source: n.id,
				target: target.id,
				who: listeners.every((a) => a?.anyone) ? "anyone" : "a maintainer",
				automations: listeners.map((a) => a?.title ?? ""),
			},
		];
	});
}

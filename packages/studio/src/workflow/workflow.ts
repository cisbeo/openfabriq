import { type Factory, workflowGraph } from "@openfabriq/core";
import { foldEndLabels } from "./fold-end-labels.js";

/** What GET /api/workflow sends: the applied factory's graph. */
export function workflowOf(repository: string, factory: Factory) {
	return {
		repository,
		name: factory.name,
		...(factory.description ? { description: factory.description } : {}),
		graph: foldEndLabels(workflowGraph(factory)),
	};
}

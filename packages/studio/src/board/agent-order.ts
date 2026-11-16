import { agentOrder } from "@openfabriq/core";
import { readAppliedFactory } from "@openfabriq/runner";

/** Per project, its agents in the order the work reaches them: the board's lanes. */
export function agentOrderByProject(
	projects: string[],
): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	for (const repo of projects) {
		const factory = readAppliedFactory(repo);
		if (factory) out[repo] = agentOrder(factory);
	}
	return out;
}

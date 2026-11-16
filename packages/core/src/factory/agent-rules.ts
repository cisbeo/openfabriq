import type { z } from "zod";
import { TOOLS, type Tool } from "../vocabulary.js";
import { isOneOf, suggested, unknownWord } from "../words.js";
import { agentNetwork, type Network } from "./network.js";
import type { AgentShape, FactoryShape, Parsed } from "./schema.js";

/** The agent's tools the engine knows, and a problem for each other one. */
export function parseTools(
	raw: z.output<(typeof AgentShape)["tools"]> | undefined,
): { tools: Tool[]; problems: string[] } {
	const problems: string[] = [];
	const tools: Tool[] = [];
	for (const tool of raw ?? [])
		if (isOneOf(TOOLS, tool)) tools.push(tool);
		else problems.push(unknownWord("tool", tool, TOOLS, "tools"));
	return { tools, problems };
}

/** What an agent asks of factory.yaml that it does not give, and an agent without a job. */
export function agentProblems(
	agent: {
		tools: Tool[];
		mcp: Record<string, unknown> | undefined;
		network: Network | undefined;
		body: string;
	},
	fields: Parsed<typeof FactoryShape>,
): string[] {
	const servers = fields.mcp ?? {};
	const network = agentNetwork(fields, agent);
	return [
		...(agent.tools.includes("web") && network !== "any" && !network.length
			? [
					"tools has web, but network is none: the agent could reach no site. Remove web, or give the agent the sites it reads",
				]
			: []),
		...(agent.tools.includes("commands") &&
		Object.keys(fields.commands ?? {}).length === 0
			? ["tools has commands, but factory.yaml names no commands"]
			: []),
		...Object.keys(agent.mcp ?? {})
			.filter((server) => !Object.hasOwn(servers, server))
			.map((server) =>
				suggested(
					`mcp.${server}: no server "${server}" in factory.yaml.`,
					server,
					Object.keys(servers),
				),
			),
		...(agent.body
			? []
			: ["the body is empty: describe the agent's job below the header"]),
	];
}

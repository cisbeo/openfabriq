import { listOrNothing } from "../../factory/text.js";
import type { Factory, McpServer } from "../../factory/types.js";
import type { PlanTopic } from "./topic.js";

// What runs on this machine: setup, commands and checks, the variables they get, MCP servers.

/** What runs on this machine around the agents: setup, commands and checks. */
export function harnessChanges(
	before: Factory | undefined,
	after: Factory,
): PlanTopic {
	const security: string[] = [];
	const settings: string[] = [];
	// setup runs commands on this machine, before every agent.
	const setupBefore = listOrNothing(before?.setup ?? []);
	const setupAfter = listOrNothing(after.setup ?? []);
	if (setupAfter !== setupBefore) {
		if (!after.setup) settings.push(`- setup: ${setupBefore}`);
		else if (!before?.setup)
			security.push(
				`+ setup runs on this machine before every agent: ${setupAfter}`,
			);
		else security.push(`~ setup: ${setupBefore} → ${setupAfter}`);
	}
	// Commands run on this machine; a check removed is a guard less.
	const commandsBefore = before?.commands ?? {};
	const commandsAfter = after.commands ?? {};
	for (const [name, command] of Object.entries(commandsAfter).sort()) {
		const old = commandsBefore[name];
		if (old === undefined)
			security.push(`+ command ${name} runs on this machine: ${command}`);
		else if (old !== command)
			security.push(`~ command ${name}: ${old} → ${command}`);
	}
	for (const name of Object.keys(commandsBefore).sort())
		if (!(name in commandsAfter)) settings.push(`- command ${name}`);
	const checksBefore = before?.checks ?? [];
	const checksAfter = after.checks ?? [];
	const addedChecks = checksAfter.filter((c) => !checksBefore.includes(c));
	const removedChecks = checksBefore.filter((c) => !checksAfter.includes(c));
	if (addedChecks.length)
		settings.push(`+ checks: ${listOrNothing(addedChecks)}`);
	if (removedChecks.length)
		security.push(`- checks no longer run ${listOrNothing(removedChecks)}`);
	// A review removed from an automation that stays is a guard less too.
	for (const [name, old] of Object.entries(before?.automations ?? {}).sort()) {
		const now = after.automations[name];
		if (old.reviewedBy && now && !now.reviewedBy)
			security.push(
				`- automation ${name}: ${old.reviewedBy} no longer reviews its change before it leaves the machine`,
			);
	}
	return { security, settings };
}

/** The variables and secrets given to code that runs on this machine. */
export function envAndSecretChanges(
	before: Factory | undefined,
	after: Factory,
): PlanTopic {
	const security: string[] = [];
	// Variables reach code that runs on this machine; secret values are never shown.
	const envBefore = before?.env ?? {};
	const envAfter = after.env ?? {};
	for (const [name, value] of Object.entries(envAfter).sort()) {
		const old = envBefore[name];
		if (old === undefined)
			security.push(`+ env ${name}=${value}, for setup, commands and agents`);
		else if (old !== value) security.push(`~ env ${name}: ${old} → ${value}`);
	}
	for (const name of Object.keys(envBefore).sort())
		if (!(name in envAfter)) security.push(`- env ${name}`);
	const secretsBefore = before?.secrets ?? [];
	const secretsAfter = after.secrets ?? [];
	for (const name of secretsAfter.filter((s) => !secretsBefore.includes(s)))
		security.push(
			`+ secret ${name}, from this machine, for setup and commands`,
		);
	for (const name of secretsBefore.filter((s) => !secretsAfter.includes(s)))
		security.push(`- secret ${name}`);
	return { security, settings: [] };
}

const serverText = (s: McpServer) =>
	"url" in s
		? `at ${s.url}${s.secret ? `, with the secret ${s.secret}` : ""}`
		: `${s.command}${s.secrets ? `, with the secrets ${listOrNothing(s.secrets)}` : ""}`;

/** The MCP servers agents may use; one run by command runs on this machine. */
export function mcpServers(
	before: Factory | undefined,
	after: Factory,
): PlanTopic {
	const security: string[] = [];
	const settings: string[] = [];
	const old = before?.mcp ?? {};
	const now = after.mcp ?? {};
	for (const [name, server] of Object.entries(now).sort()) {
		const was = old[name];
		if (!was)
			security.push(
				"url" in server
					? `+ mcp server ${name}, ${serverText(server)}`
					: `+ mcp server ${name} runs on this machine: ${serverText(server)}`,
			);
		else if (serverText(was) !== serverText(server))
			security.push(
				`~ mcp server ${name}: ${serverText(was)} → ${serverText(server)}`,
			);
	}
	for (const name of Object.keys(old).sort())
		if (!(name in now)) settings.push(`- mcp server ${name}`);
	return { security, settings };
}

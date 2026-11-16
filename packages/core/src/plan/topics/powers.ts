import { answerMentionsText } from "../../factory/answer-mentions.js";
import {
	agentNetwork,
	DEFAULT_NETWORK,
	gainedSites,
	networkText,
	PACKAGES,
	setupNetwork,
} from "../../factory/network.js";
import { listOrNothing, permissionText, whenText } from "../../factory/text.js";
import type {
	Agent,
	Automation,
	Factory,
	MergeConditions,
	Permission,
} from "../../factory/types.js";
import { includesName } from "../../vocabulary.js";
import { sentenceList } from "../../words.js";
import type { PlanTopic } from "./topic.js";

// What agents and automations can newly do: tools, MCP tools, permissions, who starts them.

/** The tools of an agent's MCP servers, as server.tool. */
export const mcpTools = (agent: Agent | undefined) =>
	Object.entries(agent?.mcp ?? {}).flatMap(([server, tools]) =>
		tools.map((tool) => `${server}.${tool}`),
	);

/** What agents and automations can newly do, and for whom. */
export function powerGains(
	before: Factory | undefined,
	after: Factory,
): PlanTopic {
	return {
		security: [
			...agentPowers(before, after),
			...automationPowers(before, after),
		],
		settings: [],
	};
}

/** The tools agents can newly use, then the MCP tools they can newly call. */
function agentPowers(before: Factory | undefined, after: Factory): string[] {
	const security: string[] = [];
	const agents = Object.values(after.agents).sort((x, y) =>
		x.name.localeCompare(y.name),
	);
	for (const agent of agents)
		for (const tool of agent.tools)
			if (tool !== "read" && !before?.agents[agent.name]?.tools.includes(tool))
				security.push(`+ agent ${agent.name} can now use ${tool}`);
	for (const agent of agents) {
		const had = mcpTools(before?.agents[agent.name]);
		for (const tool of mcpTools(agent).filter((t) => !had.includes(t)))
			security.push(`+ agent ${agent.name} can now call ${tool}`);
	}
	return security;
}

/** What each automation can newly do, in name order. */
function automationPowers(
	before: Factory | undefined,
	after: Factory,
): string[] {
	return Object.values(after.automations)
		.sort((x, y) => x.name.localeCompare(y.name))
		.flatMap((automation) =>
			automationGains(
				before,
				after,
				before?.automations[automation.name],
				automation,
			),
		);
}

const delegated = (a?: Automation) =>
	a?.when.some((t) => t.event === "linear.issue.delegated") ?? false;
const hooks = (a?: Automation) =>
	a?.when.flatMap((t) => (t.webhook ? [t.webhook] : [])) ?? [];

/** What an automation can newly write, who and what can newly start it, and the stronger agent it now runs. */
function automationGains(
	before: Factory | undefined,
	after: Factory,
	old: Automation | undefined,
	now: Automation,
): string[] {
	const security: string[] = [];
	for (const gained of gainedPermissions(old?.can ?? [], now.can))
		security.push(`+ automation ${now.name} can now ${gained}`);
	if (now.from === "anyone" && old?.from !== "anyone")
		security.push(
			`+ automation ${now.name} now starts for anyone, not only maintainers`,
		);
	if (now.from === "factory" && old?.from !== "factory")
		security.push(
			`+ automation ${now.name} now also continues what the factory wrote in a run that Sentry, a webhook or someone outside the maintainers started`,
		);
	for (const hook of hooks(now).filter((h) => !hooks(old).includes(h)))
		security.push(
			`+ automation ${now.name} starts when the webhook ${hook} is received; it arrives through the relay ("openfabriq connect relay")`,
		);
	if (delegated(now) && !delegated(old))
		security.push(
			`+ automation ${now.name} starts when someone of the Linear team hands an issue to openfabriq; it arrives through the relay ("openfabriq connect relay") and needs openfabriq installed in Linear as an agent ("openfabriq connect linear")`,
		);
	if (!old) return security;
	if (old.agent !== now.agent) {
		// The agent it ran against the one it runs: what the automation's events can newly drive.
		const was = before?.agents[old.agent];
		const is = after.agents[now.agent];
		const runs = `~ automation ${now.name} now runs ${now.agent}, which can`;
		const tools = (is?.tools ?? []).filter((t) => !was?.tools.includes(t));
		if (tools.length) security.push(`${runs} use ${listOrNothing(tools)}`);
		const calls = mcpTools(is).filter((t) => !mcpTools(was).includes(t));
		if (calls.length) security.push(`${runs} call ${listOrNothing(calls)}`);
		const sites =
			is &&
			gainedSites(
				before && was ? agentNetwork(before, was) : DEFAULT_NETWORK,
				agentNetwork(after, is),
			);
		if (sites?.length) security.push(`${runs} reach ${reachText(sites)}`);
	}
	if (
		now.from === "anyone" &&
		old.from === "anyone" &&
		whenText(old) !== whenText(now)
	)
		security.push(
			`~ automation ${now.name} starts for anyone on new events: ${whenText(now)}`,
		);
	return security;
}

/** Whether more pull requests can merge alone: a condition dropped, or a list that lets more through. */
function mergeWidened(
	before: MergeConditions,
	after: MergeConditions,
): boolean {
	const more = (old?: string[], now?: string[]) =>
		old !== undefined &&
		(now === undefined || now.some((x) => !includesName(old, x)));
	return (
		more(before.labels, after.labels) ||
		more(before.only_paths, after.only_paths) ||
		(before.except_paths !== undefined &&
			(after.except_paths === undefined ||
				before.except_paths.some((x) => !after.except_paths?.includes(x))))
	);
}

/** What an automation can newly write: a new action, or a label restriction widened or lifted. */
function gainedPermissions(
	before: Permission[],
	after: Permission[],
): string[] {
	const gained: string[] = [];
	for (const permission of after) {
		const old = before.find((p) => p.action === permission.action);
		// A merge widened is shown whole: its conditions are the limit of what merges alone.
		if (permission.merge) {
			const text = permissionText(permission);
			if (!old?.merge || mergeWidened(old.merge, permission.merge))
				gained.push(
					permission.merge.only_paths
						? text
						: `${text}: any pull request it allows, whatever files it changes`,
				);
		} else if (!old)
			gained.push(
				!permission.labels &&
					(permission.action === "add_labels" ||
						permission.action === "remove_labels")
					? `${permission.action} (any label)`
					: permissionText(permission),
			);
		// create_issue's labels go on every issue it opens and restrict nothing: only new ones are a gain.
		else if (
			permission.action === "create_issue" ||
			(old.labels && permission.labels)
		) {
			const added = (permission.labels ?? []).filter(
				(l) => !includesName(old.labels, l),
			);
			if (added.length)
				gained.push(`${permission.action} (${added.join(", ")})`);
		} else if (old.labels) gained.push(`${permission.action} (any label)`);
	}
	return gained;
}

const reachText = (entries: string[]) =>
	sentenceList(
		entries.map((e) => (e === PACKAGES ? "the package registries" : e)),
	);

/**
 * The sites agents, setup and the local MCP servers can newly reach. A new agent, or a first
 * apply, is compared with the default: the package registries.
 */
export function networkGains(
	before: Factory | undefined,
	after: Factory,
): PlanTopic {
	const security: string[] = [];
	const agents = Object.values(after.agents).sort((x, y) =>
		x.name.localeCompare(y.name),
	);
	for (const agent of agents) {
		const old = before?.agents[agent.name];
		const gained = gainedSites(
			before && old ? agentNetwork(before, old) : DEFAULT_NETWORK,
			agentNetwork(after, agent),
		);
		if (gained.length)
			security.push(`+ agent ${agent.name} can now reach ${reachText(gained)}`);
	}
	const setupGained = gainedSites(
		setupNetwork(before ?? {}),
		setupNetwork(after),
	);
	if (after.setup?.length && setupGained.length)
		security.push(`+ setup can now reach ${reachText(setupGained)}`);
	const localMcp = Object.values(after.mcp ?? {}).some((s) => "command" in s);
	const mcpGained = gainedSites(
		before?.network ?? DEFAULT_NETWORK,
		after.network ?? DEFAULT_NETWORK,
	);
	if (localMcp && mcpGained.length)
		security.push(
			`+ the factory's local MCP servers can now reach ${reachText(mcpGained)}`,
		);
	const was = networkText(before?.network ?? DEFAULT_NETWORK);
	const is = networkText(after.network ?? DEFAULT_NETWORK);
	return {
		security,
		settings: before && was !== is ? [`~ network: ${was} → ${is}`] : [],
	};
}

/** Answering mentions gives agents pushes on their pull requests: plan says it with the security changes. */
export function mentions(
	before: Factory | undefined,
	after: Factory,
): PlanTopic {
	const was = before && answerMentionsText(before);
	const is = answerMentionsText(after);
	if (was === is) return { security: [], settings: [] };
	const line = !is
		? "- answer-mentions: off"
		: `${was ? "~" : "+"} answer-mentions: ${is}`;
	return { security: [line], settings: [] };
}

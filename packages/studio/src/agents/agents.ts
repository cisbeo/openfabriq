import {
	type Automation,
	agentOrder,
	cronWords,
	type Factory,
	type FactoryFiles,
	nextRun,
	resourceFolder,
} from "@openfabriq/core";
import { skillDocs } from "./skills.js";

/** A schedule of an automation: in words, and its next run in the factory's time zone. */
export interface Schedule {
	cron: string;
	words: string;
	next?: string | undefined;
}

/** What GET /api/agents sends: the factory's harness, and its agents in the order the work reaches them, with their automations and skills. */
export function agentsView(
	repository: string,
	files: FactoryFiles,
	factory: Factory,
	now: Date,
) {
	const automations = Object.values(factory.automations);
	// In the order the work reaches them.
	const order = agentOrder(factory);
	const rank = (name: string) => order.indexOf(name);
	// In words, and the next run in the factory's time zone.
	const withSchedules = (
		a: Automation,
	): Automation & { schedules?: Schedule[] } => {
		const schedules = a.when.flatMap((t) =>
			t.cron
				? [
						{
							cron: t.cron,
							words: cronWords(t.cron),
							next: nextRun(t.cron, now, factory.timezone)?.toISOString(),
						},
					]
				: [],
		);
		return schedules.length ? { ...a, schedules } : a;
	};
	return {
		repository,
		name: factory.name,
		model: factory.model,
		limits: factory.limits,
		// The factory's harness: what agents can run, and what judges their code.
		...(factory.commands ? { commands: factory.commands } : {}),
		...(factory.checks ? { checks: factory.checks } : {}),
		...(factory.timezone ? { timezone: factory.timezone } : {}),
		// Addresses, commands and secret names; never a secret's value.
		...(factory.mcp ? { mcp: factory.mcp } : {}),
		agents: Object.values(factory.agents)
			.sort((a, b) => rank(a.name) - rank(b.name))
			.map((agent) => ({
				...agent,
				automations: automations
					.filter((a) => a.agent === agent.name)
					.map(withSchedules),
				// The automations whose change it reads before it reaches GitHub (reviewed_by).
				reviews: automations
					.filter((a) => a.reviewedBy === agent.name)
					.map(withSchedules),
				// Its agent.md as written, settings included; none for an agent of the engine.
				source:
					files[`${resourceFolder("agents", agent.name, agent.area)}/agent.md`],
				skillDocs: skillDocs(files, agent.name, agent.area),
			})),
	};
}

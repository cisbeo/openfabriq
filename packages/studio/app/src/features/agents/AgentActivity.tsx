import type { ReactNode } from "react";
import { ago, duration, money } from "../../lib/format.js";
import { runsHref } from "../../lib/route.js";
import type { ProjectAgents, RunRecord } from "../../lib/types.js";
import { RunList } from "../runs/RunList.js";
import { State } from "./AgentCard.js";
import type { AgentInfo } from "./AgentDetail.js";
import { AutomationFlow } from "./AutomationFlow.js";
import { agentStats, shownAutomations } from "./agent-facts.js";

// When an agent works and what it did: its automations, its numbers, its latest runs.

function Stat({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="min-w-0 px-4 py-3">
			<dt className="text-xs text-fg-2">{label}</dt>
			<dd className="tnum mt-1 truncate text-base font-medium text-fg">
				{children}
			</dd>
		</div>
	);
}

/** Its model, and what its runs add up to. */
export function Figures({
	data,
	agent,
	runs,
}: {
	data: ProjectAgents;
	agent: AgentInfo;
	runs: RunRecord[];
}) {
	const stats = agentStats(runs);
	return (
		<dl className="panel mb-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-line">
			<Stat label="Model">
				<span className="font-mono text-sm">{agent.model ?? data.model}</span>
			</Stat>
			<Stat label="Runs">
				{stats.runs}
				{stats.failed > 0 && (
					<span className="ml-1.5 text-xs font-normal text-bad">
						{stats.failed} failed
					</span>
				)}
			</Stat>
			<Stat label="Average run">{duration(stats.averageMs)}</Stat>
			<Stat label="Cost">{money(stats.costUsd)}</Stat>
			<Stat label="Last run">
				{stats.working ? (
					<span className="text-sm font-normal">
						<State stats={stats} working="Running now" />
					</span>
				) : (
					((stats.last && ago(stats.last.queuedAt)) ?? "Never")
				)}
			</Stat>
		</dl>
	);
}

/** The automations that start the agent, then those whose change it reviews (reviewed_by). */
export function Automations({
	data,
	agent,
	runs,
	project,
}: {
	data: ProjectAgents;
	agent: AgentInfo;
	runs: RunRecord[];
	project: string;
}) {
	const automations = shownAutomations(agent);
	if (automations.length === 0 && agent.reviews.length === 0)
		return (
			<p className="rounded-xl border border-dashed border-line-2 px-5 py-6 text-sm text-fg-2">
				No automation starts this agent yet. Add one in{" "}
				<code className="font-mono text-xs">openfabriq/automations/</code> with{" "}
				<code className="font-mono text-xs">agent: {agent.name}</code>, or name
				it in another one's{" "}
				<code className="font-mono text-xs">reviewed_by</code>.
			</p>
		);
	const flow = (a: AgentInfo["automations"][number]) => (
		<AutomationFlow
			key={a.name}
			automation={a}
			agent={a.agent}
			lastRun={runs.find((r) => r.automation === a.name)}
			timezone={data.timezone}
			project={project}
			current={agent.name}
			reviewRounds={data.limits?.review_rounds}
		/>
	);
	return (
		<div className="space-y-8">
			{automations.length > 0 && (
				<div className="space-y-4">{automations.map(flow)}</div>
			)}
			{agent.reviews.length > 0 && (
				<section aria-labelledby={`${agent.name}-reviews`}>
					<h2
						id={`${agent.name}-reviews`}
						className="text-base font-semibold text-fg"
					>
						Reviews
					</h2>
					<p className="mt-1 mb-4 text-sm text-fg-2">
						It reads the change of these automations before it reaches GitHub,
						and sends it back until it approves.
					</p>
					<div className="space-y-4">{agent.reviews.map(flow)}</div>
				</section>
			)}
		</div>
	);
}

/** Its latest runs, under the tab that names them, with a link to all of them past ten. */
export function RecentRuns({
	agent,
	runs,
	project,
}: {
	agent: AgentInfo;
	runs: RunRecord[];
	project: string;
}) {
	return (
		<>
			<RunList runs={runs.slice(0, 10)} project={project} hideAgent />
			{runs.length > 10 && (
				<p className="mt-3 text-sm">
					<a
						href={runsHref({ project, agent: agent.name })}
						className="text-fg-2 no-underline hover:text-fg"
					>
						All {runs.length} runs
					</a>
				</p>
			)}
		</>
	);
}

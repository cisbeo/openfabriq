import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { useAgentHue } from "../../hooks/use-agent-hue.js";
import { ACTION_WORDS } from "../../lib/format.js";
import type { Metrics } from "../../lib/types.js";
import { Card, Figure, none, PerDay } from "./charts.js";
import {
	gains,
	percent,
	productivity,
	runsPerDay,
	unaided,
} from "./overview-figures.js";

const runs = (n: number) => `${n} ${n === 1 ? "run" : "runs"}`;

/** What the factory did: its runs, what they turned into, and where humans intervened. */
export function Productivity({
	m,
	waiting,
	board,
}: {
	m: Metrics;
	/** Cards waiting for a person now; undefined until the board is read. */
	waiting: number | undefined;
	board: string;
}) {
	const agentHue = useAgentHue();
	const p = productivity(m);
	const alone = unaided(m);
	const saved = gains(m);
	const [agent, setAgent] = useState("");
	const agents = [
		...new Set(m.cost.byDay.flatMap((d) => Object.keys(d.agents))),
	].sort();
	// An agent with no run in the new period falls back to all of them.
	const shown = agents.includes(agent) ? agent : "";
	return (
		<>
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<Card title="Merged as written">
					<Figure value={saved.asWritten ?? none}>
						{saved.asWrittenWords ||
							"pull requests merged with no commit of a person"}
					</Figure>
				</Card>
				<Card title="Issue to merge">
					<Figure value={saved.issueToMerge ?? none}>
						{saved.issueToMergeWords ||
							"from the issue a pull request closes to its merge"}
					</Figure>
				</Card>
				<Card title="Hands-off runs">
					<Figure value={alone.share ?? none}>{alone.words}</Figure>
				</Card>
				<Card title="Human interventions">
					<Figure value={m.interventions.total}>{p.steppedInWords}</Figure>
					{waiting !== undefined && (
						<div className="mt-auto pt-3">
							{waiting > 0 ? (
								<a
									href={board}
									className="group flex items-center justify-between gap-2 rounded-lg bg-warn-soft px-3 py-1.5 text-xs font-medium text-fg no-underline transition-colors duration-150 hover:bg-warn/20"
								>
									<span>
										<span className="tnum">{waiting}</span> waiting for you
									</span>
									<ArrowRight
										className="size-3.5 shrink-0 text-fg-2 transition-transform duration-150 group-hover:translate-x-0.5"
										aria-hidden
									/>
								</a>
							) : (
								<p className="flex items-center gap-1.5 text-xs text-fg-2">
									<Check className="size-3.5 text-ok" aria-hidden />
									Nothing waits for you
								</p>
							)}
						</div>
					)}
				</Card>
			</div>
			<div className="mt-3 grid gap-3 lg:grid-cols-2">
				<Card
					title="Runs per day"
					action={
						agents.length > 1 && (
							<select
								aria-label="Agent"
								className="select h-7 text-xs"
								value={shown}
								onChange={(e) => setAgent(e.target.value)}
							>
								<option value="">All agents</option>
								{agents.map((a) => (
									<option key={a} value={a}>
										{a}
									</option>
								))}
							</select>
						)
					}
				>
					<div className="mt-4 flex flex-1 flex-col">
						<PerDay
							days={runsPerDay(m.cost.byDay, shown || undefined)}
							format={runs}
							minStep={1}
							color={shown ? agentHue(shown) : "var(--ok)"}
							partColor={agentHue}
						/>
					</div>
				</Card>
				<Card title="Outputs applied">
					{p.applied === 0 ? (
						<p className="mt-2 text-sm text-fg-2">Nothing applied yet.</p>
					) : (
						<>
							<Figure value={p.applied}>on GitHub, by the engine</Figure>
							<ul className="tnum mt-4 space-y-2.5 text-[13px]">
								{p.outputs.map((a) => (
									<li
										key={a.action}
										className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-3"
									>
										<span className="truncate text-fg-2">
											{ACTION_WORDS[a.action] ?? a.action}
										</span>
										<span className="h-1.5 rounded-full bg-sunken">
											<span
												className="block h-full rounded-full bg-ok/70"
												style={{ width: percent(a.count, p.most) }}
											/>
										</span>
										<span className="text-right font-medium text-fg">
											{a.count}
										</span>
									</li>
								))}
							</ul>
						</>
					)}
				</Card>
			</div>
		</>
	);
}

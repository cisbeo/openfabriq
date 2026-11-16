import { AgentTag } from "../../components/badges.js";
import { useAgentHue } from "../../hooks/use-agent-hue.js";
import { money } from "../../lib/format.js";
import type { Metrics } from "../../lib/types.js";
import { Card, Figure, none, PerDay, Shares } from "./charts.js";
import { costRatios, returns, spendingParts } from "./overview-figures.js";

/** What the factory spent: in all, per unit of work, per day, and who spent it. */
export function Spending({ m }: { m: Metrics }) {
	const parts = spendingParts(m, useAgentHue());
	const cost = costRatios(m);
	const back = returns(m);
	return (
		<>
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<Card title="Spent">
					<Figure value={money(m.cost.totalUsd)}>
						{[
							cost.perRun !== undefined && `${money(cost.perRun)} per run`,
							m.cost.chatUsd > 0 && `${money(m.cost.chatUsd)} in chat`,
						]
							.filter(Boolean)
							.join(" · ") || "agents and chat"}
					</Figure>
				</Card>
				<Card title="Cost per PR merged as written">
					<Figure
						value={
							back.perAsWritten === undefined ? none : money(back.perAsWritten)
						}
					>
						{cost.perMergedPr !== undefined
							? `${money(cost.perMergedPr)} per merged PR`
							: "a pull request merged with no commit of a person"}
					</Figure>
				</Card>
				<Card title="Time gained per issue">
					<Figure value={back.timeGained ?? none}>
						{back.timeGainedWords ||
							"the median wait from issue to merge, against your team's"}
					</Figure>
				</Card>
				<Card title="Lost to failed runs">
					<Figure value={m.runs.total > 0 ? money(m.cost.failedUsd) : none}>
						{m.runs.failed > 0
							? `${m.runs.failed} failed ${m.runs.failed === 1 ? "run" : "runs"}`
							: m.runs.total > 0 && "no failed run"}
					</Figure>
				</Card>
			</div>
			<div className="mt-3 grid gap-3 lg:grid-cols-2">
				<Card title="Cost per day">
					<div className="mt-4 flex flex-1 flex-col">
						<PerDay
							days={m.cost.byDay.map((d) => ({
								day: d.day,
								value: d.usd,
								runs: d.runs,
							}))}
							format={(v) => money(v).replace("< ", "")}
							color="var(--accent)"
							unit="spent"
							minStep={0.01}
						/>
					</div>
				</Card>
				<Card title="Cost per agent">
					{parts.length === 0 ? (
						<p className="mt-2 text-sm text-fg-2">Nothing spent yet.</p>
					) : (
						<>
							<div className="mt-4">
								<Shares
									label={parts
										.map((p) => `${p.key} ${money(p.value)}`)
										.join(", ")}
									parts={parts}
								/>
							</div>
							<ul className="tnum mt-3 divide-y divide-line text-[13px]">
								{parts.map((p) => (
									<li
										key={p.key}
										className="flex items-baseline justify-between gap-3 py-1.5"
									>
										{p.key === "chat" ? (
											<span className="inline-flex items-center gap-1.5 text-fg-2">
												<span
													aria-hidden
													className="size-2 shrink-0 rounded-[3px] bg-fg-3"
												/>
												Chat
											</span>
										) : (
											<AgentTag name={p.key} className="text-[13px]" />
										)}
										<span className="shrink-0 text-fg">
											{p.runs !== undefined && (
												<span className="mr-3 text-2xs text-fg-3">
													{p.runs} {p.runs === 1 ? "run" : "runs"}
												</span>
											)}
											{money(p.value)}
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

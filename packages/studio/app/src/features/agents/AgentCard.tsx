import { BookOpen, ChevronRight, Zap } from "lucide-react";
import { useAgentHue } from "../../hooks/use-agent-hue.js";
import { ago, money } from "../../lib/format.js";
import type { AgentInfo } from "./AgentDetail.js";
import { automationCount, type Stats } from "./agent-facts.js";

/** Whether the agent works now, else when it last ran. */
export function State({
	stats,
	working = "Working now",
}: {
	stats: Stats;
	working?: string;
}) {
	if (stats.working)
		return (
			<span className="inline-flex items-center gap-1.5 font-medium text-accent-text">
				<span className="relative flex size-1.5" aria-hidden>
					<span
						className="absolute inset-0 rounded-full bg-current opacity-60"
						style={{
							animation: "ping-dot 1.4s cubic-bezier(0,0,0.2,1) infinite",
						}}
					/>
					<span className="relative size-1.5 rounded-full bg-current" />
				</span>
				{working}
			</span>
		);
	return (
		<span className="text-fg-3">
			{stats.last ? `Last run ${ago(stats.last.queuedAt)}` : "Never ran"}
		</span>
	);
}

export function AgentCard({
	agent,
	stats,
	href,
	defaultModel,
}: {
	agent: AgentInfo;
	stats: Stats;
	href: string;
	defaultModel: string;
}) {
	const agentHue = useAgentHue();
	return (
		<li>
			<a
				href={href}
				className="group flex h-full flex-col rounded-2xl border border-line bg-panel p-5 text-fg no-underline shadow-1 transition-[border-color,box-shadow,transform] duration-200 ease-out-quint hover:-translate-y-px hover:border-line-2 hover:shadow-2"
			>
				<span className="flex items-center gap-3">
					<span
						aria-hidden
						className="flex size-9 shrink-0 items-center justify-center rounded-xl"
						style={{
							background: `color-mix(in oklch, ${agentHue(agent.name)} 16%, transparent)`,
						}}
					>
						<span
							className="size-3 rounded-[4px]"
							style={{ background: agentHue(agent.name) }}
						/>
					</span>
					<span className="min-w-0 flex-1">
						<span className="block truncate text-base font-semibold tracking-[-0.01em]">
							{agent.name}
						</span>
						<span className="block truncate font-mono text-xs text-fg-3">
							{agent.model ?? defaultModel}
							{/* The wiki's agent comes with the engine, not from openfabriq/. */}
							{agent.builtIn && (
								<span className="ml-1.5 font-sans">
									· built into openfabriq
								</span>
							)}
						</span>
					</span>
					<ChevronRight
						className="size-4 shrink-0 text-fg-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-fg-2"
						aria-hidden
					/>
				</span>
				<span className="mt-4 line-clamp-3 flex-1 text-sm text-pretty text-fg-2">
					{agent.description}
				</span>
				<span className="mt-4 flex flex-wrap items-center gap-1.5">
					<span className="chip">
						<BookOpen className="size-3.5" aria-hidden />
						{agent.skillDocs.length}{" "}
						{agent.skillDocs.length === 1 ? "skill" : "skills"}
					</span>
					<span className="chip">
						<Zap className="size-3.5" aria-hidden />
						{automationCount(agent)}{" "}
						{automationCount(agent) === 1 ? "automation" : "automations"}
					</span>
				</span>
				<span className="tnum mt-4 flex items-center justify-between gap-3 border-t border-line pt-3 text-xs">
					<State stats={stats} />
					<span className="text-fg-2">
						{stats.runs} {stats.runs === 1 ? "run" : "runs"}
						{stats.runs > 0 && ` · ${money(stats.costUsd)}`}
					</span>
				</span>
			</a>
		</li>
	);
}

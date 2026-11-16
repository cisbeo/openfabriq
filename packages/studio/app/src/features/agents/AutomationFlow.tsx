import { type Automation, resourceFolder } from "@openfabriq/core";
import {
	ArrowDown,
	ChevronRight,
	Layers,
	MessageSquare,
	Play,
	Repeat,
	Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { HintChip, Status } from "../../components/badges.js";
import { MarkdownDoc } from "../../components/markdown.js";
import { useAgentHue } from "../../hooks/use-agent-hue.js";
import { ago, EVENT_SHORT } from "../../lib/format.js";
import { eventIcon, ICONS, type Icon } from "../../lib/icons.js";
import { agentHref } from "../../lib/route.js";
import type { RunRecord, Schedule } from "../../lib/types.js";
import {
	automationChips,
	automationOutputs,
	nextRun,
	triggerTokens,
} from "./agent-facts.js";

/** A small rounded tag in the diagram: a label, a path, a schedule. */
function Token({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex h-5 items-center rounded-md bg-hover px-1.5 font-mono text-2xs text-fg-2">
			{children}
		</span>
	);
}

/** One box of the diagram: an icon, a few words, and its tags. */
function Node({
	icon: Icon,
	tone,
	label,
	children,
}: {
	icon: Icon;
	tone: string;
	label: string;
	children?: ReactNode;
}) {
	return (
		<li className="rounded-xl border border-line bg-panel px-3 py-2.5 shadow-1">
			<span className="flex items-center gap-2 text-sm font-medium text-fg">
				<Icon className={`size-4 shrink-0 ${tone}`} aria-hidden />
				{label}
			</span>
			{children && (
				<span className="mt-2 flex flex-wrap gap-1 pl-6">{children}</span>
			)}
		</li>
	);
}

/** An agent's name and color, a link to its page when it is another agent's. */
function AgentChip({
	name,
	hue,
	href,
	small,
}: {
	name: string;
	hue: string;
	href?: string | undefined;
	small?: boolean;
}) {
	const className = small
		? "inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1 text-xs font-medium text-fg no-underline"
		: "inline-flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2.5 text-sm font-medium text-fg no-underline shadow-1";
	const content = (
		<>
			<span
				aria-hidden
				className={small ? "size-2 rounded-[2px]" : "size-2.5 rounded-[3px]"}
				style={{ background: hue }}
			/>
			{name}
		</>
	);
	return href ? (
		<a href={href} className={`${className} hover:border-line-2`}>
			{content}
		</a>
	) : (
		<span className={className}>{content}</span>
	);
}

function Column({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="min-w-0">
			<p className="mb-2.5 text-xs font-medium text-fg-3">{title}</p>
			{children}
		</div>
	);
}

/** The arrow between two columns: down on a phone, right on a wider screen. */
function Link() {
	return (
		<div aria-hidden className="flex justify-center text-line-2 md:block">
			<ArrowDown className="size-4 md:hidden" />
			<span className="mt-[38px] hidden items-center md:flex">
				<span className="h-px flex-1 bg-line-2" />
				<ChevronRight className="-ml-1.5 size-4" />
			</span>
		</div>
	);
}

/** "Tue 4 Nov, 02:00", in the factory's time zone when it has one. */
const when = (iso: string, timeZone?: string) =>
	new Date(iso).toLocaleString("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
		...(timeZone ? { timeZone } : {}),
	});

/**
 * An automation as a diagram read left to right: what triggers it, the agent that works,
 * the outputs it may write. Two short badges carry the rules of the run.
 */
export function AutomationFlow({
	automation: a,
	agent,
	lastRun,
	timezone,
	project,
	current,
	reviewRounds,
}: {
	automation: Automation & { schedules?: Schedule[] };
	agent: string;
	/** Its latest run: shown for a schedule, next to its next run. */
	lastRun?: RunRecord | undefined;
	timezone?: string | undefined;
	project?: string | undefined;
	/** The agent whose page shows it: its own name is not a link. */
	current?: string | undefined;
	/** `review_rounds` of factory.yaml, shown with the reviewer. */
	reviewRounds?: number | undefined;
}) {
	const agentHue = useAgentHue();
	const next = nextRun(a.schedules);
	return (
		<article className="overflow-hidden rounded-2xl border border-line bg-panel shadow-1">
			<header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-3">
				<h3 className="font-mono text-sm font-medium text-fg">{a.name}</h3>
				{/* The wiki's and the answer to mentions come with the engine, not from openfabriq/. */}
				{a.builtIn && (
					<span className="text-xs text-fg-3">built into openfabriq</span>
				)}
				<span className="ml-auto flex items-center gap-1.5">
					{automationChips(a).map((chip) => (
						<HintChip
							key={chip.key}
							icon={
								chip.key === "from" ? (
									<Users className="size-3.5" aria-hidden />
								) : (
									<Layers className="size-3.5" aria-hidden />
								)
							}
							label={chip.label}
							hint={chip.hint}
						/>
					))}
				</span>
			</header>
			<div className="grid gap-3 bg-sunken/30 px-5 py-6 md:grid-cols-[minmax(0,1fr)_40px_auto_40px_minmax(0,1fr)] md:gap-0">
				<Column title="Trigger">
					<ul className="space-y-2">
						{/* No event: it runs only when someone asks, as the wiki does. */}
						{a.when.length === 0 && (
							<Node icon={Play} tone="text-fg-2" label="When asked">
								<Token>openfabriq run {a.name}</Token>
							</Node>
						)}
						{a.when.map((t) => {
							const tokens = triggerTokens(t, a.schedules);
							return (
								<Node
									key={`${t.event}${t.labels?.join() ?? ""}${t.cron ?? ""}${t.query ?? ""}`}
									icon={eventIcon(t.event)}
									tone="text-fg-2"
									label={EVENT_SHORT[t.event] ?? t.event}
								>
									{tokens.length
										? tokens.map((token, i) => (
												// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list where two tags can read the same (a label and the query)
												<Token key={`${i}:${token}`}>{token}</Token>
											))
										: null}
								</Node>
							);
						})}
					</ul>
					{next && (
						<div className="mt-3 space-y-1 text-xs text-fg-2">
							<p>
								Next run{" "}
								<span className="tnum text-fg">{when(next, timezone)}</span>
								{timezone && <span className="text-fg-3"> · {timezone}</span>}
							</p>
							{lastRun && (
								<p className="flex items-center gap-1.5">
									Last run
									<Status status={lastRun.status} className="text-xs" />
									<span className="tnum">{ago(lastRun.queuedAt)}</span>
								</p>
							)}
						</div>
					)}
				</Column>
				<Link />
				<Column title="Agent">
					<div className="flex flex-col items-start gap-2">
						<AgentChip
							name={agent}
							hue={agentHue(agent)}
							href={agent !== current ? agentHref(agent, project) : undefined}
						/>
						{a.reviewedBy && (
							<div className="rounded-xl border border-dashed border-line-2 px-3 py-2">
								<span className="flex items-center gap-1.5 text-xs text-fg-2">
									<Repeat className="size-3.5 shrink-0" aria-hidden />
									Reviewed before it reaches GitHub by
								</span>
								<span className="mt-1.5 flex flex-wrap items-center gap-1.5">
									<AgentChip
										name={a.reviewedBy}
										hue={agentHue(a.reviewedBy)}
										href={
											a.reviewedBy !== current
												? agentHref(a.reviewedBy, project)
												: undefined
										}
										small
									/>
									{reviewRounds !== undefined && (
										<Token>
											up to {reviewRounds}{" "}
											{reviewRounds === 1 ? "round" : "rounds"}
										</Token>
									)}
								</span>
							</div>
						)}
					</div>
				</Column>
				<Link />
				<Column title="Output">
					{a.can.length === 0 ? (
						<p className="rounded-xl border border-dashed border-line-2 px-3 py-2.5 text-sm text-fg-2">
							Nothing, read only
						</p>
					) : (
						<ul className="space-y-2">
							{automationOutputs(a).map((o) => (
								<Node
									key={o.key}
									icon={ICONS[o.action] ?? MessageSquare}
									tone="text-accent-text"
									label={o.label}
								>
									{o.tokens.length
										? o.tokens.map((t, i) => (
												// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list where two tags can read the same
												<Token key={`${i}:${t}`}>{t}</Token>
											))
										: null}
								</Node>
							))}
						</ul>
					)}
				</Column>
			</div>
			{a.instructions.trim() && (
				<div className="border-t border-line px-5 py-2">
					<MarkdownDoc
						title="Task"
						path={
							a.builtIn
								? "built into openfabriq"
								: `openfabriq/${resourceFolder("automations", a.name, a.area)}/automation.md`
						}
						text={a.instructions.trim()}
						flush
					/>
				</div>
			)}
		</article>
	);
}

import { AgentTag, Status } from "../../components/badges.js";
import { ago, duration, money, runTitle, subject } from "../../lib/format.js";
import { eventIcon } from "../../lib/icons.js";
import { runHref } from "../../lib/route.js";
import type { RunRecord } from "../../lib/types.js";
import { trigger } from "./run-filters.js";

/** The mark of what started a run: a pull request, an issue, a push, a schedule. */
function TriggerIcon({ event }: { event: string }) {
	const Icon = eventIcon(event);
	return <Icon className="size-3.5 shrink-0 text-fg-3" aria-hidden />;
}

/** One grid for the header and the rows, so each title sits above its column. */
const COLUMNS =
	"xl:grid-cols-[112px_minmax(0,3fr)_minmax(0,2fr)_72px_72px_88px]";

/** The runs as rows, each a link to its detail. Shared by the runs page and an agent's page. */
export function RunList({
	runs,
	project,
	showProject = false,
	hideAgent = false,
}: {
	runs: RunRecord[];
	project: string | undefined;
	showProject?: boolean;
	/** On an agent's page, every row is that agent: say the automation instead. */
	hideAgent?: boolean;
}) {
	return (
		<div className="panel overflow-hidden">
			<div
				className={`hidden gap-4 border-b border-line bg-sunken px-4 py-2 text-xs font-medium text-fg-2 xl:grid ${COLUMNS}`}
			>
				<span>Status</span>
				<span>Subject</span>
				<span>{hideAgent ? "Automation" : "Agent"}</span>
				<span className="text-right">Duration</span>
				<span className="text-right">Cost</span>
				<span className="text-right">Queued</span>
			</div>
			<ul className="divide-y divide-line">
				{runs.map((r) => (
					<li key={r.id}>
						<a
							href={runHref(r.id, { project })}
							className={`grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-4 py-3 text-sm text-fg no-underline transition-colors duration-150 hover:bg-hover xl:items-center ${COLUMNS}`}
						>
							<Status status={r.status} className="xl:order-none" />
							<span className="tnum text-right text-xs text-fg-2 xl:hidden">
								{ago(r.queuedAt)}
							</span>
							<span className="col-span-2 min-w-0 xl:col-span-1">
								<span className="flex min-w-0 items-baseline gap-2">
									<span className="tnum shrink-0 text-fg-2">{subject(r)}</span>
									<span className="truncate font-medium">{runTitle(r)}</span>
								</span>
								<span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-fg-3">
									<TriggerIcon event={r.event} />
									<span className="truncate" title={r.event}>
										{showProject && `${r.repository} · `}
										{trigger(r)}
									</span>
								</span>
								{r.reason && (
									<span
										// Two lines at most, like the board: the whole error is on the run's page.
										className={`mt-1 line-clamp-2 text-xs break-words text-pretty first-letter:uppercase ${r.status === "failed" ? "text-bad" : "text-fg"}`}
									>
										{r.reason}
									</span>
								)}
							</span>
							<span className="col-span-2 min-w-0 truncate text-xs text-fg-2 xl:col-span-1 xl:text-sm">
								{hideAgent ? (
									r.automation
								) : (
									<span className="inline-flex max-w-full items-center gap-1.5">
										<AgentTag name={r.agent} className="text-fg" />
										<span aria-hidden className="text-fg-3/60">
											·
										</span>
										<span className="truncate text-fg-3">{r.automation}</span>
									</span>
								)}
								<span className="xl:hidden">
									{" "}
									· {duration(r.durationMs)} · {money(r.costUsd)}
								</span>
							</span>
							<span className="tnum hidden text-right text-fg-2 xl:block">
								{duration(r.durationMs)}
							</span>
							<span className="tnum hidden text-right text-fg-2 xl:block">
								{money(r.costUsd)}
							</span>
							<span
								className="tnum hidden text-right text-xs text-fg-2 xl:block"
								title={new Date(r.queuedAt).toLocaleString()}
							>
								{ago(r.queuedAt)}
							</span>
						</a>
					</li>
				))}
			</ul>
		</div>
	);
}

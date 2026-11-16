import type { ReactNode } from "react";
import { Elapsed } from "../../components/badges.js";
import { useNow } from "../../hooks/use-now.js";
import {
	ago,
	clock,
	dateTime,
	duration,
	money,
	tokens,
} from "../../lib/format.js";
import type { RunRecord } from "../../lib/types.js";

function Fact({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="-mt-px flex items-baseline justify-between gap-4 border-t border-line py-2.5">
			<dt className="shrink-0 text-sm text-fg-2">{label}</dt>
			<dd className="min-w-0 truncate text-right text-sm text-fg">
				{children}
			</dd>
		</div>
	);
}

export function Facts({
	run,
	turns,
}: {
	run: RunRecord;
	turns: number | undefined;
}) {
	const mono = "font-mono text-xs";
	return (
		<dl className="panel grid grid-cols-1 gap-x-8 overflow-hidden px-5 pb-px sm:grid-cols-2 lg:grid-cols-3">
			<Fact label="Automation">
				<span className={mono}>{run.automation}</span>
			</Fact>
			<Fact label="Event">
				<span className={mono}>
					{run.event}
					{run.label ? ` · ${run.label}` : ""}
				</span>
			</Fact>
			{run.manual && (
				<Fact label="Started by">
					{run.manual}
					<span className="text-fg-3"> · manual run</span>
				</Fact>
			)}
			{run.scheduledFor &&
				new Date(run.queuedAt).getTime() -
					new Date(run.scheduledFor).getTime() >
					2 * 60_000 && (
					// A schedule missed while the engine slept, run once on waking.
					<Fact label="Scheduled for">
						<span className="tnum">
							{dateTime(run.scheduledFor)}
							<span className="text-fg-3"> · caught up</span>
						</span>
					</Fact>
				)}
			<Fact label="Queued">
				<span className="tnum">{clock(run.queuedAt)}</span>
			</Fact>
			{run.startedAt && (
				<Fact label="Started">
					<span className="tnum">
						{clock(run.startedAt)}
						<span className="text-fg-3">
							{" "}
							· waited{" "}
							{duration(
								new Date(run.startedAt).getTime() -
									new Date(run.queuedAt).getTime(),
							)}
						</span>
					</span>
				</Fact>
			)}
			{run.endedAt && (
				<Fact label="Ended">
					<span className="tnum">{clock(run.endedAt)}</span>
				</Fact>
			)}
			{run.variables && (
				// Names only, never a value.
				<Fact label="Variables for setup and commands">
					<span className={mono}>
						{[...run.variables.env, ...run.variables.secrets].join(", ") || "—"}
					</span>
					{run.variables.missing.length > 0 && (
						<span className="text-bad">
							{" "}
							· missing on the machine: {run.variables.missing.join(", ")}
						</span>
					)}
				</Fact>
			)}
			{run.mcpUnavailable && (
				// Listed in agent.md, not offered by the server: the run went on without them.
				<Fact label="MCP tools not available">
					<span className={`${mono} text-bad`}>
						{run.mcpUnavailable.join(", ")}
					</span>
				</Fact>
			)}
			<Fact label="Model">
				<span className={mono}>{run.model ?? "—"}</span>
			</Fact>
			<Fact label="Tokens">
				<span className="tnum">
					{run.tokens
						? `${tokens(run.tokens.input)} in · ${tokens(run.tokens.output)} out`
						: "—"}
				</span>
			</Fact>
			<Fact label="Turns">
				<span className="tnum">{turns ?? "—"}</span>
			</Fact>
			<Fact label="Run">
				<span className={mono}>{run.id}</span>
			</Fact>
			<Fact label="Project">
				<span className={mono}>{run.repository}</span>
			</Fact>
		</dl>
	);
}

/** When, how long, how much: the three figures a person checks first, set apart from the words. */
export function Figures({ run }: { run: RunRecord }) {
	const now = useNow(30_000);
	const started = run.startedAt ?? run.queuedAt;
	const live = run.status === "running" && run.startedAt;
	const cell = "flex items-baseline gap-1.5";
	const value = "tnum font-medium";
	return (
		<dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm [&_dt]:text-fg-2">
			<div className={cell}>
				<dt>{run.startedAt ? "Started" : "Queued"}</dt>
				<dd className={`${value} text-fg`} title={ago(started, now)}>
					{dateTime(started)}
				</dd>
			</div>
			<div className={cell}>
				<dt>Duration</dt>
				<dd className={`${value} ${live ? "text-accent-text" : "text-fg"}`}>
					{live ? (
						<Elapsed since={run.startedAt as string} />
					) : run.status === "queued" ? (
						<span className="text-fg-3">—</span>
					) : (
						duration(run.durationMs)
					)}
				</dd>
			</div>
			<div className={cell}>
				<dt>Cost</dt>
				<dd
					className={`${value} text-fg`}
					{...(run.costUsd === undefined
						? { title: "Known when the run ends" }
						: {})}
				>
					{run.costUsd === undefined ? (
						<span className="text-fg-3">—</span>
					) : (
						money(run.costUsd)
					)}
				</dd>
			</div>
		</dl>
	);
}

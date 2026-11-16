import { ListChecks } from "lucide-react";
import { useState } from "react";
import { Empty, ErrorNote, Skeleton } from "../../components/feedback.js";
import { PageHeader } from "../../components/page-layout.js";
import { SearchInput } from "../../components/search-input.js";
import { useApi } from "../../hooks/use-api.js";
import { query } from "../../lib/api.js";
import { STATUSES } from "../../lib/format.js";
import { runsHref } from "../../lib/route.js";
import type { RunRecord } from "../../lib/types.js";
import { RunList } from "./RunList.js";
import { filterRuns } from "./run-filters.js";

export function Runs({
	project,
	agent,
	status,
}: {
	project: string | undefined;
	agent: string | undefined;
	status: string | undefined;
}) {
	const { data: runs, error } = useApi<RunRecord[]>(
		`/api/runs${query({ project })}`,
		5000,
	);
	// Typed text stays on this page: the filters in the address are agent and status.
	const [text, setText] = useState("");
	const { agents, shown, count } = filterRuns(runs ?? [], agent, status, text);
	const href = (over: Record<string, string | undefined>) =>
		runsHref({ project, agent, status, ...over });

	return (
		<>
			<PageHeader
				title="Runs"
				description="Every time an automation started an agent, latest first."
			/>
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<nav
					aria-label="Status"
					className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-line bg-sunken p-0.5"
				>
					{[undefined, ...STATUSES].map((s) => {
						return (
							<a
								key={s ?? "all"}
								href={href({ status: s })}
								aria-current={s === status ? "true" : undefined}
								className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm capitalize text-fg-2 no-underline transition-colors hover:text-fg aria-[current]:bg-panel aria-[current]:font-medium aria-[current]:text-fg aria-[current]:shadow-1"
							>
								{s ?? "All"}
								<span className="tnum text-xs text-fg-3">{count(s)}</span>
							</a>
						);
					})}
				</nav>
				{/* Search and agent narrow the list; held to the table's right edge, on their own row when narrow. */}
				<div className="flex w-full items-center gap-2 xl:ml-auto xl:w-auto">
					<SearchInput
						label="Search runs"
						value={text}
						onChange={setText}
						className="flex-1 xl:w-64 xl:flex-none"
					/>
					<select
						aria-label="Agent"
						className="select h-8.5 shrink-0"
						value={agent ?? ""}
						onChange={(e) => {
							window.location.hash = href({
								agent: e.target.value || undefined,
							});
						}}
					>
						<option value="">All agents</option>
						{agents.map((a) => (
							<option key={a} value={a}>
								{a}
							</option>
						))}
					</select>
				</div>
			</div>
			{error && !runs ? (
				<ErrorNote>{error}</ErrorNote>
			) : !runs ? (
				<Skeleton className="h-96" />
			) : shown.length === 0 ? (
				<Empty icon={<ListChecks />} title="No run here">
					{runs.length === 0
						? "Runs appear when an automation of the factory starts, for example when an issue gets a label it listens to."
						: "No run matches these filters."}
				</Empty>
			) : (
				<RunList runs={shown} project={project} showProject={!project} />
			)}
		</>
	);
}

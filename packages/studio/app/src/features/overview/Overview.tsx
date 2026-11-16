import { FolderGit2 } from "lucide-react";
import { AgentTag, Status } from "../../components/badges.js";
import { Empty, ErrorNote, Skeleton } from "../../components/feedback.js";
import { PageHeader } from "../../components/page-layout.js";
import { Segmented } from "../../components/segmented.js";
import { useApi } from "../../hooks/use-api.js";
import { query } from "../../lib/api.js";
import { ago, runTitle, subject } from "../../lib/format.js";
import { overviewHref, pageHref, runHref, runsHref } from "../../lib/route.js";
import type {
	Board,
	Period,
	ProjectMetrics,
	RunRecord,
} from "../../lib/types.js";
import { waitingFor } from "./overview-figures.js";
import { Productivity } from "./Productivity.js";
import { Spending } from "./Spending.js";

const PERIODS: { value: Period; label: string }[] = [
	{ value: "7d", label: "7 days" },
	{ value: "30d", label: "30 days" },
	{ value: "all", label: "All time" },
];

const VIEWS = [
	{ id: "productivity", label: "Productivity" },
	{ id: "cost", label: "Cost and return" },
] as const;
type View = (typeof VIEWS)[number]["id"];

function LatestRuns({ runs, project }: { runs: RunRecord[]; project: string }) {
	return (
		<section>
			<div className="mb-3 flex items-baseline justify-between gap-4">
				<h3 className="text-sm font-medium text-fg">Latest runs</h3>
				<a
					href={runsHref({ project })}
					className="text-sm text-fg-2 no-underline hover:text-fg"
				>
					All runs
				</a>
			</div>
			{runs.length === 0 ? (
				<p className="text-sm text-fg-2">No run yet.</p>
			) : (
				<ul className="panel divide-y divide-line">
					{runs.map((r) => (
						<li key={r.id}>
							<a
								href={runHref(r.id, { project })}
								className="flex items-center gap-3 px-4 py-2.5 text-sm text-fg no-underline transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-hover sm:px-5"
							>
								<Status status={r.status} className="w-24 shrink-0" />
								<span className="tnum hidden w-24 shrink-0 truncate text-fg-2 sm:block">
									{subject(r)}
								</span>
								<span className="min-w-0 flex-1 truncate">{runTitle(r)}</span>
								<span className="hidden w-28 shrink-0 md:block">
									<AgentTag name={r.agent} className="max-w-full" />
								</span>
								<span className="tnum w-16 shrink-0 text-right text-xs text-fg-2 sm:w-20">
									{ago(r.queuedAt)}
								</span>
							</a>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function ProjectBlock({
	data: { repository, name, metrics: m },
	runs,
	board,
	view,
}: {
	data: ProjectMetrics;
	runs: RunRecord[];
	board: Board | undefined;
	view: View;
}) {
	const latest = runs.filter((r) => r.repository === repository).slice(0, 5);
	const waiting = waitingFor(board, repository);
	return (
		<section>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="flex min-w-0 items-baseline gap-2">
					<span className="truncate text-base font-semibold tracking-[-0.01em]">
						{name ?? repository}
					</span>
					{name && (
						<span className="truncate font-mono text-xs text-fg-3">
							{repository}
						</span>
					)}
				</h2>
				<a
					href={pageHref("agents", repository)}
					className="text-sm text-fg-2 no-underline hover:text-fg"
				>
					Agents
				</a>
			</div>

			<div className="mt-4">
				{view === "cost" ? (
					<Spending m={m} />
				) : (
					<Productivity
						m={m}
						waiting={waiting}
						board={pageHref("board", repository)}
					/>
				)}
			</div>

			<div className="mt-10">
				<LatestRuns runs={latest} project={repository} />
			</div>
		</section>
	);
}

export function Overview({
	project,
	period: asked,
	view: askedView,
	board,
}: {
	project: string | undefined;
	period: string | undefined;
	view: string | undefined;
	/** The project's board, which the app reads already for the navigation. */
	board: Board | undefined;
}) {
	const period = PERIODS.find((p) => p.value === asked)?.value ?? "7d";
	const view = VIEWS.find((v) => v.id === askedView)?.id ?? "productivity";
	// The default of each is left out of the URL.
	const href = (to: { period?: Period; view?: View }) => {
		const p = to.period ?? period;
		const v = to.view ?? view;
		return overviewHref({
			project,
			period: p === "7d" ? undefined : p,
			view: v === "productivity" ? undefined : v,
		});
	};
	const { data, error } = useApi<ProjectMetrics[]>(
		`/api/metrics${query({ project, period })}`,
		15_000,
	);
	const { data: runs } = useApi<RunRecord[]>(
		`/api/runs${query({ project })}`,
		5000,
	);
	return (
		<>
			<PageHeader
				title="Overview"
				description="What the factory did, what it cost, and where humans intervened."
			>
				<Segmented
					label="Period"
					value={period}
					options={PERIODS}
					href={(p) => href({ period: p })}
				/>
			</PageHeader>
			<nav
				aria-label="Overview"
				className="mb-6 flex gap-1 border-b border-line"
			>
				{VIEWS.map((v) => (
					<a
						key={v.id}
						href={href({ view: v.id })}
						aria-current={v.id === view ? "page" : undefined}
						className="-mb-px inline-flex h-10 shrink-0 items-center border-b-2 border-transparent px-3 text-sm font-medium text-fg-2 no-underline transition-colors duration-150 hover:text-fg aria-[current]:border-fg aria-[current]:text-fg"
					>
						{v.label}
					</a>
				))}
			</nav>
			{error && !data ? (
				<ErrorNote>{error}</ErrorNote>
			) : !data ? (
				<div className="space-y-4" aria-busy="true">
					<Skeleton className="h-5 w-48" />
					<Skeleton className="h-72" />
					<Skeleton className="mt-10 h-56" />
				</div>
			) : data.length === 0 ? (
				<Empty icon={<FolderGit2 />} title="No project yet">
					Run <code className="font-mono text-xs">openfabriq apply</code> in a
					repository with an{" "}
					<code className="font-mono text-xs">openfabriq/</code> folder, then{" "}
					<code className="font-mono text-xs">openfabriq start</code>.
				</Empty>
			) : (
				<div className="space-y-16">
					{data.map((p) => (
						<ProjectBlock
							key={p.repository}
							data={p}
							runs={runs ?? []}
							board={board}
							view={view}
						/>
					))}
				</div>
			)}
			{data && data.length > 0 && (
				<p className="mt-10 text-xs text-fg-3">
					Merged pull requests are asked to GitHub with gh, read only, every few
					minutes.
				</p>
			)}
		</>
	);
}

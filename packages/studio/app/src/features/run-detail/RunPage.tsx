import { ChevronRight, ExternalLink, MessageSquareText } from "lucide-react";
import { useMemo, useState } from "react";
import {
	OutcomesContext,
	SourceContext,
} from "../../components/assistant-ui/output.js";
import { AgentTag, Pill } from "../../components/badges.js";
import { Empty, ErrorNote, PageSkeleton } from "../../components/feedback.js";
import { Prose } from "../../components/markdown.js";
import { Section } from "../../components/page-layout.js";
import { type TabItem, Tabs } from "../../components/tabs.js";
import { placeOf, runTitle, subject } from "../../lib/format.js";
import { sourceMark } from "../../lib/icons.js";
import { agentHref, runHref, runsHref } from "../../lib/route.js";
import type { RunDetail, RunRecord } from "../../lib/types.js";
import { filesCount, outputsCount, produced } from "./produced.js";
import { RunCommands } from "./RunCommands.js";
import { Facts, Figures } from "./RunFacts.js";
import { RunGraph } from "./RunGraph.js";
import { RunLog } from "./RunLog.js";
import { RunFiles, RunOutputs } from "./RunOutputs.js";
import { RunReviews } from "./RunReviews.js";
import { toolCalls } from "./run-log.js";
import { useRun } from "./use-run.js";
import { WhatToDo } from "./WhatToDo.js";
import { reportNote, runTab, type Tab, whatToDo } from "./what-to-do.js";

/** The agent's closing words, which say what it did and why. */
function Report({ text }: { text: string }) {
	const [open, setOpen] = useState(false);
	const long = text.length > 1400;
	return (
		<div className="panel relative px-5 py-4">
			<div className={long && !open ? "max-h-96 overflow-hidden" : ""}>
				<Prose>{text}</Prose>
			</div>
			{long && !open && (
				<div className="absolute inset-x-0 bottom-0 flex h-24 items-end justify-center rounded-b-xl bg-gradient-to-t from-panel from-40% to-transparent pb-4">
					<button
						type="button"
						onClick={() => setOpen(true)}
						className="btn h-7 text-xs"
					>
						Read all
					</button>
				</div>
			)}
		</div>
	);
}

export function RunPage({
	id,
	project,
	tab,
}: {
	id: string;
	project: string | undefined;
	tab: string | undefined;
}) {
	const { data, error } = useRun(id, project);

	const view = useMemo(() => {
		if (!data) return undefined;
		const calls = toolCalls(data.transcript);
		return {
			calls,
			produced: produced(
				data.run,
				calls,
				data.changedFiles,
				Boolean(data.reviews?.length),
			),
			report: data.transcript.result?.text?.trim(),
		};
	}, [data]);

	if (error && !data)
		return error === "No such run." ? (
			<Empty icon={<MessageSquareText />} title="This run does not exist">
				Its project may no longer be registered.{" "}
				<a href={runsHref({ project })} className="text-accent-text">
					See all runs
				</a>
			</Empty>
		) : (
			<ErrorNote>{error}</ErrorNote>
		);
	if (!data || !view) return <PageSkeleton />;
	const { run, transcript } = data;
	const link = run.source?.url ?? run.url;
	const subj = subject(run);
	const counts = {
		outputs: outputsCount(view.produced),
		files: filesCount(view.produced),
	};
	const current = runTab(tab, run.status, counts);
	const tabHref = (t: Tab) => runHref(run.id, { project, tab: t });
	const callout = whatToDo(data);

	return (
		<OutcomesContext.Provider value={run.outputs}>
			<SourceContext.Provider value={run.source?.kind}>
				<RunHeader run={run} project={project} link={link} subj={subj} />

				{!callout && run.status === "skipped" && run.reason && (
					<p className="mb-6 rounded-xl bg-hover px-5 py-3 text-sm text-fg-2">
						Skipped: {run.reason}. Nothing to do.
					</p>
				)}
				{callout && (
					<WhatToDo
						ask={callout}
						{...(link ? { link } : {})}
						linkLabel={`Open ${subj}`}
						tabHref={tabHref}
					/>
				)}

				<RunTabs counts={counts} current={current} tabHref={tabHref} />

				{current === "summary" && (
					<Summary
						detail={data}
						steps={view.calls.length}
						report={view.report}
						note={reportNote(run, transcript.messages.length > 0)}
					/>
				)}
				{current === "logs" && <RunLog detail={data} project={project} />}
				{current === "outputs" && (
					<RunOutputs agent={run.agent} produced={view.produced} />
				)}
				{current === "files" && <RunFiles produced={view.produced} />}
			</SourceContext.Provider>
		</OutcomesContext.Provider>
	);
}

/** Where the run belongs, what it is about, who ran it, and its figures. */
function RunHeader({
	run,
	project,
	link,
	subj,
}: {
	run: RunRecord;
	project: string | undefined;
	link: string | undefined;
	subj: string;
}) {
	const Source = sourceMark(run);
	return (
		<>
			<nav
				aria-label="Breadcrumb"
				// The app's header carries it from tablets up.
				className="mb-6 flex items-center gap-1.5 text-sm text-fg-2 md:hidden"
			>
				<a href={runsHref({ project })} className="no-underline hover:text-fg">
					Runs
				</a>
				<ChevronRight className="size-3.5 text-fg-3" aria-hidden />
				<a
					href={runsHref({ project, agent: run.agent })}
					className="no-underline hover:text-fg"
				>
					{run.agent}
				</a>
				<ChevronRight className="size-3.5 text-fg-3" aria-hidden />
				<span className="truncate font-mono text-xs text-fg-3">{run.id}</span>
			</nav>

			<header className="mb-6">
				<h1 className="max-w-[60ch] text-2xl leading-8 font-semibold tracking-[-0.02em] text-balance">
					{link ? (
						<a
							href={link}
							target="_blank"
							rel="noreferrer noopener"
							title={`Open ${subj} on ${placeOf(link)}`}
							className="tnum group/subj mr-2 inline-flex items-baseline gap-1.5 text-fg-3 no-underline transition-colors duration-150 hover:text-accent-text"
						>
							<Source className="size-5 self-center" aria-hidden />
							{subj}
							<ExternalLink
								className="size-3.5 self-center opacity-60 transition-opacity group-hover/subj:opacity-100"
								aria-hidden
							/>
						</a>
					) : (
						<span className="tnum mr-2 inline-flex items-baseline gap-1.5 text-fg-3">
							<Source className="size-5 self-center" aria-hidden />
							{subj}
						</span>
					)}
					{runTitle(run)}
				</h1>
				{/* One bar: who and what on the left, when, how long and how much on the right. */}
				<div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-8 gap-y-2">
					<p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-fg-2">
						<Pill status={run.status} />
						<a
							href={agentHref(run.agent, project ?? run.repository)}
							title={`Open ${run.agent}'s page`}
							className="-mx-1 rounded-md px-1 py-0.5 no-underline transition-colors duration-150 hover:bg-hover"
						>
							<AgentTag
								name={run.agent}
								className="text-sm text-fg underline decoration-line-2 underline-offset-4"
							/>
						</a>
					</p>
					<Figures run={run} />
				</div>
			</header>
		</>
	);
}

/** Summary, Logs, Outputs when the run proposed some, and Files changed when it changed some. */
function RunTabs({
	counts,
	current,
	tabHref,
}: {
	counts: { outputs: number; files: number };
	current: Tab;
	tabHref: (t: Tab) => string;
}) {
	const tabs: TabItem<Tab>[] = [
		{ id: "summary", label: "Summary" },
		{ id: "logs", label: "Logs" },
		...(counts.outputs > 0
			? [{ id: "outputs" as const, label: "Outputs", count: counts.outputs }]
			: []),
		...(counts.files > 0
			? [{ id: "files" as const, label: "Files changed", count: counts.files }]
			: []),
	];
	return <Tabs label="Run" tabs={tabs} current={current} href={tabHref} />;
}

/** What happened, what the agent reported, what the engine ran, and the run's details. */
function Summary({
	detail,
	steps,
	report,
	note,
}: {
	detail: RunDetail;
	steps: number;
	report: string | undefined;
	note: string | undefined;
}) {
	const { run, transcript } = detail;
	return (
		<div className="space-y-10">
			<Section title="What happened">
				<RunGraph detail={detail} steps={steps} />
			</Section>
			{report ? (
				<Section title={`What ${run.agent} reported`}>
					<Report text={report} />
				</Section>
			) : (
				note && (
					<Section title={`What ${run.agent} reported`}>
						<p className="text-sm text-fg-2">{note}</p>
					</Section>
				)
			)}
			{detail.reviews && detail.reviews.length > 0 && (
				<Section
					title="Internal review"
					aside={`by ${detail.reviews[0]?.reviewer}, before anything left the machine`}
				>
					<RunReviews reviews={detail.reviews} />
				</Section>
			)}
			{detail.commands.length > 0 && (
				<Section
					title="Checks and commands"
					aside="run by the engine, without credentials"
				>
					<RunCommands commands={detail.commands} />
				</Section>
			)}
			<Section title="Details">
				<Facts run={run} turns={run.turns ?? transcript.result?.turns} />
			</Section>
		</div>
	);
}

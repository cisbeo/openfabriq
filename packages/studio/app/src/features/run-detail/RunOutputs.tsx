import { ChevronRight, Factory, FilePen } from "lucide-react";
import { type ReactNode, useContext, useState } from "react";
import { isHandoffComment } from "../../../../src/runs/story.js";
import {
	OutputCard,
	OutputLink,
	SourceContext,
} from "../../components/assistant-ui/output.js";
import { Input } from "../../components/assistant-ui/tool-call.js";
import { Pill } from "../../components/badges.js";
import { Section } from "../../components/page-layout.js";
import { fromGitHub, outputHeadline, outputWords } from "../../lib/format.js";
import type { RunRecord } from "../../lib/types.js";
import { FileDiff } from "./FileDiff.js";
import { openAtFirst, type Produced } from "./produced.js";

function Written({ outputs }: { outputs: RunRecord["outputs"] }) {
	const source = useContext(SourceContext);
	return (
		<ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel shadow-1">
			{outputs.map((o, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: outputs have no id and never reorder
				<li key={i} className="flex items-start gap-3 px-4 py-3 text-sm">
					<Factory className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden />
					<div className="min-w-0 flex-1">
						<p className="font-medium text-fg">
							{outputWords(o.action, source)}
						</p>
						<p className="mt-0.5 text-fg-2">
							{isHandoffComment(o)
								? "openfabriq's note that it hands this over to a person"
								: outputHeadline(o.summary)}
						</p>
						{o.reason && <p className="mt-1 text-xs text-warn">{o.reason}</p>}
					</div>
					<span className="flex shrink-0 items-center gap-3">
						{o.url && <OutputLink url={o.url} />}
						<Pill status={o.status} />
					</span>
				</li>
			))}
		</ul>
	);
}

function Counts({ add, del, noPatch }: Produced["files"][number]) {
	return (
		<span className="tnum ml-auto shrink-0 pl-2 font-mono text-2xs">
			{add === undefined && del === undefined && (
				<span className="text-fg-3">binary</span>
			)}
			{noPatch === "too large" && (
				<span className="mr-2 font-sans text-fg-3">diff too large</span>
			)}
			{!!add && <span className="text-ok">+{add}</span>}
			{!!del && <span className="ml-1.5 text-bad">−{del}</span>}
		</span>
	);
}

/** A file's row: its path and counts, unfolding to what changed in it when there is something to show. */
function FileRow({
	file,
	children,
	open = false,
}: {
	file: Produced["files"][number];
	children?: () => ReactNode;
	open?: boolean;
}) {
	// The body renders only while open: a folded diff of thousands of lines costs nothing.
	const [shown, setShown] = useState(open);
	if (!children)
		return (
			<li className="flex min-h-11 items-center gap-2.5 pr-4 pl-10 text-sm">
				<FilePen className="size-3.5 shrink-0 text-fg-2" aria-hidden />
				<span className="min-w-0 truncate font-mono text-xs text-fg">
					{file.path}
				</span>
				<Counts {...file} />
			</li>
		);
	return (
		<li>
			<details
				className="group/file"
				open={open}
				onToggle={(e) => setShown(e.currentTarget.open)}
			>
				<summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-4 text-sm transition-colors duration-150 hover:bg-hover [&::-webkit-details-marker]:hidden">
					<ChevronRight
						className="size-3.5 shrink-0 text-fg-3 transition-transform duration-150 group-open/file:rotate-90"
						aria-hidden
					/>
					<FilePen className="size-3.5 shrink-0 text-fg-2" aria-hidden />
					<span className="min-w-0 truncate font-mono text-xs text-fg">
						{file.path}
					</span>
					<Counts {...file} />
				</summary>
				{shown && children()}
			</details>
		</li>
	);
}

function Files({ files }: { files: Produced["files"] }) {
	const open = openAtFirst(files);
	return (
		<ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel shadow-1">
			{files.map((f) =>
				f.hunks?.length ? (
					<FileRow key={f.path} file={f} open={open.has(f.path)}>
						{() => <FileDiff path={f.path} hunks={f.hunks ?? []} />}
					</FileRow>
				) : // Without a recorded diff (a running or older run), the agent's edit calls show what it wrote.
				f.edits.length > 0 && !f.hunks && !f.noPatch ? (
					<FileRow key={f.path} file={f}>
						{() => (
							<div className="space-y-2 px-4 pt-1 pb-4 pl-[46px]">
								{f.edits.map((e) => (
									<Input key={e.toolCallId} part={e} />
								))}
							</div>
						)}
					</FileRow>
				) : (
					<FileRow key={f.path} file={f} />
				),
			)}
		</ul>
	);
}

/** What the agent asked to write, and what openfabriq wrote. */
export function RunOutputs({
	agent,
	produced: p,
}: {
	agent: string;
	produced: Produced;
}) {
	// A run from Slack, Linear or Sentry writes its comments and labels there.
	const onGitHub = fromGitHub(useContext(SourceContext));
	return (
		<div className="space-y-10">
			{p.proposals.length > 0 && (
				<Section
					title={`Proposed by ${agent}`}
					aside={`openfabriq writes them${onGitHub ? " on GitHub" : ""} after the run, when the factory allows it`}
				>
					<div className="space-y-3">
						{p.proposals.map((part) => (
							<OutputCard key={part.toolCallId} part={part} full />
						))}
					</div>
				</Section>
			)}
			{p.written.length > 0 && (
				<Section
					title={
						p.proposals.length > 0 || !onGitHub
							? "Written by openfabriq"
							: "Written on GitHub"
					}
				>
					<Written outputs={p.written} />
				</Section>
			)}
		</div>
	);
}

/** The files the run changed in its own copy of the repository. */
export function RunFiles({ produced: p }: { produced: Produced }) {
	return (
		<Section
			title="Files changed"
			aside={
				p.fromGit
					? "from Git: the run's commits and what it left in its copy of the repository, whatever wrote them"
					: "from the agent's edit tool calls: files its shell wrote are not listed"
			}
		>
			<Files files={p.files} />
			{p.more > 0 && (
				<p className="mt-2 text-xs text-fg-2">
					and {p.more} more {p.more === 1 ? "file" : "files"}, not listed
				</p>
			)}
		</Section>
	);
}

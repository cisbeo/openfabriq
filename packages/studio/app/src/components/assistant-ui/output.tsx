import type { SourceKind } from "@openfabriq/core";
import { ChevronRight, ExternalLink, Wrench } from "lucide-react";
import { createContext, useContext, useState } from "react";
import { linkText, sourceOutput } from "../../lib/format.js";
import { ICONS } from "../../lib/icons.js";
import type { RunRecord } from "../../lib/types.js";
import { Pill } from "../badges.js";
import { Prose } from "../markdown.js";
import {
	actionOf,
	isOutcomeOf,
	outputBody,
	summaryOf,
	type ToolCallPart,
} from "./tool-parts.js";

// An output an agent proposed (a comment, a pull request, labels…), and what the engine did with it.

/** The outcomes of the run, so a proposed output shows whether the engine applied it. */
export const OutcomesContext = createContext<RunRecord["outputs"]>([]);

/** Where the run comes from: a run from Slack, Linear or Sentry writes its comments and labels there. */
export const SourceContext = createContext<SourceKind | undefined>(undefined);

/** A proposal's title, named after where the run writes it: "Slack reply" rather than "Comment". */
export function useOutputTitle(part: { toolName: string; artifact?: unknown }) {
	const source = useContext(SourceContext);
	return (
		sourceOutput(actionOf(part.toolName), source) ??
		summaryOf(part as ToolCallPart).title
	);
}

interface ProposedOutput {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	artifact?: unknown;
}

/** What the engine did with this proposed output, once the run ended. */
function useOutcome(part: ProposedOutput) {
	const outcomes = useContext(OutcomesContext);
	const action = actionOf(part.toolName);
	return outcomes.find((o) => isOutcomeOf(o, action, part.args));
}

/** What the output says: its heading, labels or text, and why it was not applied. */
function OutputBody({ part }: { part: ProposedOutput }) {
	const outcome = useOutcome(part);
	const { heading, labels, body, result, refusal, empty } = outputBody(
		part,
		outcome,
	);
	if (empty) return null;
	return (
		<>
			{heading && <p className="mb-1.5 font-medium text-fg">{heading}</p>}
			{labels && (
				<div className="flex flex-wrap gap-1.5">
					{labels.map((l) => (
						<span key={l} className="chip font-mono">
							{l}
						</span>
					))}
				</div>
			)}
			{body && <Prose className="prose-sm">{body}</Prose>}
			{result && <p className="text-fg-2">{result}</p>}
			{refusal && (
				<p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-fg first:mt-0">
					Not applied: {refusal}
				</p>
			)}
		</>
	);
}

/** "proposed", or what became of it, with its link. */
function OutcomeBadge({ part }: { part: ProposedOutput }) {
	const outcome = useOutcome(part);
	if (!outcome) return <span className="text-xs text-fg-3">proposed</span>;
	return (
		<span className="flex items-center gap-3">
			{outcome.url && <OutputLink url={outcome.url} />}
			<Pill status={outcome.status} />
		</span>
	);
}

/** Where an output was written, as a link a person sees: "Open PR #51 ↗". */
export function OutputLink({ url }: { url: string }) {
	return (
		<a
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-accent-text hover:underline"
		>
			{linkText(url)}
			<ExternalLink className="size-3" aria-hidden />
		</a>
	);
}

/**
 * A proposed output in full: what the agent asked the engine to write, and what became of
 * it. The run's page shows these first, as the run's result.
 */
export function OutputCard({
	part,
	full = false,
}: {
	part: ProposedOutput;
	/** Its whole text at once, where the card is what the page is about. */
	full?: boolean;
}) {
	const action = actionOf(part.toolName);
	const title = useOutputTitle(part);
	const Icon = ICONS[action] ?? Wrench;
	const [open, setOpen] = useState(full);
	const { empty } = outputBody(part, useOutcome(part));
	return (
		<article
			id={`output-${part.toolCallId}`}
			className="scroll-mt-24 overflow-hidden rounded-xl border border-line bg-panel shadow-1"
		>
			<header
				className={`flex items-center gap-2.5 px-4 py-2.5 ${empty ? "" : "border-b border-line"}`}
			>
				<span className="flex size-6 items-center justify-center rounded-md bg-accent-soft text-accent-text">
					<Icon className="size-3.5" aria-hidden />
				</span>
				<span className="text-sm font-medium text-fg">{title}</span>
				<span className="ml-auto">
					<OutcomeBadge part={part} />
				</span>
			</header>
			{!empty && (
				<div
					className={`relative px-4 py-3.5 ${open ? "" : "max-h-72 overflow-hidden"}`}
				>
					<OutputBody part={part} />
					{!open && (
						<div className="absolute inset-x-0 bottom-0 flex h-20 items-end justify-center bg-gradient-to-t from-panel from-40% to-transparent pb-3">
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
			)}
		</article>
	);
}

function OutputCallBody({ part }: { part: ToolCallPart }) {
	if (outputBody(part, useOutcome(part)).empty) return null;
	return (
		<div className="border-t border-line px-4 py-3.5">
			<OutputBody part={part} />
		</div>
	);
}

/** A proposed output inside the conversation: one line, opened for its content. */
export function OutputCall({ part }: { part: ToolCallPart }) {
	const action = actionOf(part.toolName);
	const { detail } = summaryOf(part);
	const title = useOutputTitle(part);
	const Icon = ICONS[action] ?? Wrench;
	return (
		<details
			id={`tool-${part.toolCallId}`}
			className="group/out my-3 scroll-mt-24 rounded-xl border border-accent-line bg-panel shadow-1"
		>
			<summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-xl px-3 text-sm transition-colors duration-150 hover:bg-hover [&::-webkit-details-marker]:hidden">
				<ChevronRight
					className="size-3.5 shrink-0 text-fg-3 transition-transform duration-150 group-open/out:rotate-90"
					aria-hidden
				/>
				<Icon className="size-3.5 shrink-0 text-accent-text" aria-hidden />
				<span className="shrink-0 font-medium text-fg">{title}</span>
				{detail && <span className="min-w-0 truncate text-fg-2">{detail}</span>}
				<span className="ml-auto shrink-0 pl-2">
					<OutcomeBadge part={part} />
				</span>
			</summary>
			<OutputCallBody part={part} />
		</details>
	);
}

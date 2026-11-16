import {
	CircleCheck,
	CircleX,
	Factory,
	FileInput,
	type LucideIcon,
	Play,
	RotateCcw,
	SkipForward,
	UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { isHandoffComment } from "../../../../src/runs/story.js";
import {
	duration,
	eventPhrase,
	money,
	outputHeadline,
	outputWords,
	subject,
} from "../../lib/format.js";
import type { RunRecord } from "../../lib/types.js";
import type { Entry } from "./run-log.js";

/** A gesture of the engine: its icon, its tone, its words. Undefined for a step of the agent. */
export function engineLine(
	e: Entry,
	run: RunRecord,
): { icon: LucideIcon; tone?: "bad" | "warn"; text: ReactNode } | undefined {
	switch (e.kind) {
		case "queued":
			return {
				icon: FileInput,
				text: (
					<>
						Queued: {eventPhrase(run.event)}
						{run.label ? ` (${run.label})` : ""}, on {subject(run)}.
					</>
				),
			};
		case "started":
			return {
				icon: Play,
				text: (
					<>
						Started <span className="font-medium text-fg">{run.agent}</span>
						{run.model ? (
							<>
								{" "}
								on <span className="font-mono text-xs">{run.model}</span>
							</>
						) : null}
						.
					</>
				),
			};
		case "stopped":
			return {
				icon: e.status === "failed" ? CircleX : SkipForward,
				tone: e.status === "failed" ? "bad" : "warn",
				text: (
					<>
						{e.status === "failed" ? "Failed" : "Skipped"}:{" "}
						{run.reason ?? "the agent ended on an error"}.
					</>
				),
			};
		case "output": {
			const o = e.output;
			return {
				icon: Factory,
				...(o.status === "applied" ? {} : { tone: "warn" as const }),
				text: (
					<span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
						<span>
							{o.status === "applied" ? "Wrote" : "Did not write"}:{" "}
							<span className="font-medium text-fg">
								{outputWords(o.action, run.source?.kind)}
							</span>{" "}
							{isHandoffComment(o)
								? "(handoff)"
								: `“${outputHeadline(o.summary)}”`}
							{o.reason ? ` — ${o.reason}` : ""}
						</span>
						{o.url && (
							<a
								href={o.url}
								target="_blank"
								rel="noreferrer noopener"
								className="text-xs text-fg-2 hover:text-fg"
							>
								Open
							</a>
						)}
					</span>
				),
			};
		}
		case "review": {
			const r = e.round;
			const verdict =
				r.verdict === "approved"
					? `approved${r.risk ? `, risk ${r.risk}` : ""}`
					: r.verdict === "needs_changes"
						? "needs changes, sent back"
						: "needs a person";
			return {
				icon:
					r.verdict === "approved"
						? CircleCheck
						: r.verdict === "needs_changes"
							? RotateCcw
							: UserRound,
				...(r.verdict === "approved" ? {} : { tone: "warn" as const }),
				text: (
					<>
						Started <span className="font-medium text-fg">{r.reviewer}</span>,
						round {r.round} of the internal review: {verdict},{" "}
						{money(r.costUsd)}.
					</>
				),
			};
		}
		case "ended":
			return {
				icon: CircleCheck,
				text: (
					<>
						Ended after {duration(run.durationMs)}
						{run.costUsd !== undefined ? `, ${money(run.costUsd)}` : ""}.
					</>
				),
			};
	}
	return undefined;
}

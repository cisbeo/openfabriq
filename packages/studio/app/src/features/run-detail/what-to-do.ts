import { HANDOFF_LABEL, REVIEW_HANDOFF } from "@openfabriq/core";
import { interrupted, isHandoffComment } from "../../../../src/runs/story.js";
import {
	eventPhrase,
	fromGitHub,
	outputWords,
	subject,
} from "../../lib/format.js";
import type { RunDetail, RunRecord } from "../../lib/types.js";

/** A line of words, some of them set apart: a file or a command, a name. */
export type Words = (string | { code: string } | { strong: string })[];

export interface Ask {
	tone: "bad" | "warn" | "accent";
	title: string;
	/** Why, in a sentence. */
	body?: Words;
	/** The error as the engine wrote it, shown as it is. */
	error?: string;
	steps: Words[];
	/** The tab that holds what the steps point to. */
	see?: "logs" | "outputs";
}

/** A run that waits or works: its page reads it again every few seconds. */
export const ACTIVE = new Set(["queued", "running"]);

/** What the summary says where the agent's report goes, while it has none; undefined for nothing. */
export function reportNote(
	run: RunRecord,
	hasMessages: boolean,
): string | undefined {
	if (!ACTIVE.has(run.status) && (run.status === "skipped" || !hasMessages))
		return undefined;
	return run.status === "queued"
		? "The run waits for its turn. The agent's report appears here when it is done."
		: run.status === "running"
			? "The agent is working. Follow it in Logs; its report appears here when it is done."
			: run.status === "failed"
				? "The agent stopped before it wrote a report. Its last steps are in Logs."
				: "The agent left no report.";
}

export type Tab = "summary" | "logs" | "outputs" | "files";

/** The tab asked for when it can show; else the log of a running run, else the summary. */
export function runTab(
	asked: string | undefined,
	status: RunRecord["status"],
	counts: { outputs: number; files: number },
): Tab {
	if (
		asked === "logs" ||
		((asked === "outputs" || asked === "files") && counts[asked] > 0)
	)
		return asked;
	if (asked === "summary") return "summary";
	return status === "running" ? "logs" : "summary";
}

/** How the run would start again: runs follow events, never a button. */
export function rerunHint(run: RunRecord): Words {
	// The same run, asked manually from a terminal on the factory's machine.
	const now = {
		code: `openfabriq run ${run.automation}${
			run.number === undefined
				? ""
				: ` --${run.isPullRequest ? "pr" : "issue"} ${run.number}`
		}`,
	};
	if (run.source && run.source.kind !== "github")
		return [
			`It runs again at the next matching event: ${eventPhrase(run.event)}.`,
		];
	if (run.label && run.event.endsWith(".labeled"))
		return [
			`To run it again, remove the label “${run.label}” from ${subject(run)} and add it back, or run `,
			now,
			" in a terminal.",
		];
	if (run.event === "schedule")
		return ["It runs again at its next scheduled time, or now with ", now, "."];
	return [
		`It runs again at the next matching event (${eventPhrase(run.event)}), or now with `,
		now,
		".",
	];
}

const LIMIT = /\((usd_per_run|minutes_per_run|usd_per_day|review_rounds)\)/;

/** The limit of the factory that stopped the run, when the engine names it in parentheses. */
const limitOf = (run: RunRecord) => run.reason?.match(LIMIT)?.[1];

const raise = (key: string): Words => [
	"To allow more, raise ",
	{ code: key },
	" in ",
	{ code: "openfabriq/factory.yaml" },
	", then run ",
	{ code: "openfabriq apply" },
	".",
];

/** What a person should do about this run, in the order they would do it. */
export function whatToDo({
	run,
	story,
	transcript,
	subjectState,
	automationFile,
}: RunDetail): Ask | undefined {
	const a = story.attention;
	if (!a) return undefined;
	// Merged, closed, done or resolved since: the person already acted, nothing waits on them.
	if (subjectState?.open === false && a.kind !== "not-applied")
		return alreadyDone(run, subjectState.merged, a.kind === "failed");
	// Someone took needs-human off: the board shows it done, nothing waits on them.
	if (a.kind === "handed-over" && subjectState?.needsHuman === false)
		return undefined;
	switch (a.kind) {
		case "interrupted":
			return ranAgain(story);
		case "failed":
			// Queued again once after a stop: an attempt stopped again is the second.
			return interrupted(run)
				? stoppedTwice(run)
				: failed(run, transcript.messages.length > 0);
		case "handed-over":
			return a.by === "engine" ? handedToYou(run) : readyForYou(run);
		case "cost-limit":
			return budgetSpent(run);
		case "not-applied":
			return notApplied(run, a.count, automationFile);
		case "no-output":
			return nothingWritten(run);
	}
}

function alreadyDone(run: RunRecord, merged: boolean, failed: boolean): Ask {
	return {
		tone: "accent",
		title: `Nothing left to do: ${subject(run)} ${
			run.source?.kind === "linear"
				? "is done or canceled in Linear"
				: run.source?.kind === "sentry"
					? "is resolved or ignored in Sentry"
					: `was ${merged ? "merged" : "closed"} on GitHub`
		}`,
		...(failed
			? {
					error: run.reason ?? "The agent ended on an error.",
					see: "logs" as const,
				}
			: {}),
		steps: [],
	};
}

function ranAgain(story: RunDetail["story"]): Ask {
	return {
		tone: "accent",
		title: "Interrupted: openfabriq ran it again",
		body: [
			"The engine stopped during this run, so openfabriq queued it again once: ",
			{ strong: `${story.rerun?.agent}, ${story.rerun?.status}` },
			". Nothing to do here.",
		],
		steps: [],
	};
}

function stoppedTwice(run: RunRecord): Ask {
	return {
		tone: "bad",
		title: "This run failed",
		see: "logs",
		error: run.reason ?? "The agent ended on an error.",
		steps: [
			[
				"The engine stopped during this run, and it was already run again once after a stop: openfabriq does not run it a third time.",
			],
			rerunHint(run),
		],
	};
}

function failed(run: RunRecord, started: boolean): Ask {
	const subj = subject(run);
	const limit = limitOf(run);
	const handed = run.outputs.some(isHandoffComment);
	return {
		tone: "bad",
		title: "This run failed",
		see: "logs",
		error: run.reason ?? "The agent ended on an error.",
		steps: [
			...(handed
				? [
						run.number !== undefined
							? [
									`openfabriq commented on ${subj} and labeled it `,
									{ code: HANDOFF_LABEL },
									": it waits for you there.",
								]
							: [`openfabriq commented on ${subj}: it waits for you there.`],
					]
				: []),
			[
				started
					? "Read the error, and the agent's last steps in Logs."
					: "Read the error: the agent did not start.",
			],
			run.reason?.includes("openfabriq connect")
				? ["Run the command the error names, in a terminal on this machine."]
				: limit
					? raise(limit)
					: ["Fix the cause, in the repository or in openfabriq/."],
			rerunHint(run),
		],
	};
}

/** The engine stopped the work and handed it over. */
function handedToYou(run: RunRecord): Ask {
	const subj = subject(run);
	const limit = limitOf(run);
	if (run.reason?.startsWith(REVIEW_HANDOFF))
		return {
			tone: "warn",
			title: "Your turn: the internal review left the pull request to you",
			body: [
				`${run.agent}'s pull request is open with ${HANDOFF_LABEL}: ${run.reason.slice(REVIEW_HANDOFF.length + 2)}.`,
			],
			steps: [
				[
					"Read the Internal review section of the pull request, and the rounds below.",
				],
				["Finish the change yourself, or close it."],
			],
		};
	return {
		tone: "warn",
		title: `Your turn: openfabriq handed ${subj} to you`,
		body: [
			`It stopped because ${
				run.reason?.startsWith("review_rounds")
					? "the pull request used all its review rounds without passing review"
					: (run.reason ?? "the agents could not finish")
			}.`,
		],
		steps: [
			[`Read openfabriq's comment and the last review on ${subj}.`],
			["Finish the change yourself, or close it."],
			...(limit ? [raise(limit)] : []),
		],
	};
}

/** The agent ended its work by handing it to a person. */
function readyForYou(run: RunRecord): Ask {
	const subj = subject(run);
	return {
		tone: "accent",
		title: `Ready for you: ${run.agent} handed ${subj} to a person`,
		body: ["Its report is below."],
		steps: run.isPullRequest
			? [
					[`Review ${subj} on GitHub.`],
					["Merge it, or comment to ask for changes."],
				]
			: [
					[`Read ${run.agent}'s comment on ${subj}.`],
					["Answer it, or label the issue for the next agent."],
				],
	};
}

function budgetSpent(run: RunRecord): Ask {
	return {
		tone: "warn",
		title: "Skipped: the factory's budget for today is spent",
		body: [`openfabriq did not start ${run.agent}. It cost nothing.`],
		steps: [
			[
				"Wait for tomorrow, or raise ",
				{ code: "usd_per_day" },
				" in ",
				{ code: "openfabriq/factory.yaml" },
				" and run ",
				{ code: "openfabriq apply" },
				".",
			],
			rerunHint(run),
		],
	};
}

/** Ended well, wrote nothing: a person who waits where the work came from sees nothing come. */
function nothingWritten(run: RunRecord): Ask {
	return {
		tone: "warn",
		title: `${run.agent} wrote nothing`,
		body: [
			`The run ended without proposing any output, so nothing changed on ${subject(run)}. Its report below says why.`,
		],
		steps: [
			[
				"If it stopped on a problem of this machine or of the repository, fix it.",
			],
			rerunHint(run),
		],
	};
}

function notApplied(run: RunRecord, count: number, file: string): Ask {
	const missed = run.outputs.filter((o) => o.status !== "applied");
	const merge = missed.find(
		(o) => o.action === "merge_pull_request" && o.status === "refused",
	);
	// A merge the factory's conditions keep for a person is the normal end, not a failure.
	if (merge && missed.length === 1) return leftToMerge(merge.reason, file);
	const where = fromGitHub(run.source?.kind) ? " on GitHub" : "";
	return {
		tone: "warn",
		see: "outputs",
		title: `${count} ${count === 1 ? "output was" : "outputs were"} not written${where}`,
		body: ["The agent proposed them; openfabriq did not write them."],
		steps: [
			...missed.map(
				(o): Words => [
					{ strong: outputWords(o.action, run.source?.kind) },
					`: ${o.reason ?? o.status}.`,
				],
			),
			missed.some((o) => o.status === "refused")
				? [
						"If the factory should allow it, add it to ",
						{ code: "can" },
						" in ",
						{
							code: file,
						},
						", then run ",
						{ code: "openfabriq apply" },
						".",
					]
				: [`If it matters, write it${where} yourself.`],
		],
	};
}

function leftToMerge(reason: string | undefined, file: string): Ask {
	return {
		tone: "warn",
		see: "outputs",
		title: "Left for you to merge",
		body: [
			"The agent asked to merge it; the factory's conditions keep it for a person.",
		],
		steps: [
			[{ strong: "Why" }, `: ${reason ?? "refused"}.`],
			[
				"Merge it on GitHub when it is right. To let such pull requests merge alone, widen the conditions of ",
				{ code: "merge_pull_request" },
				" in ",
				{
					code: file,
				},
				", then run ",
				{ code: "openfabriq apply" },
				".",
			],
		],
	};
}

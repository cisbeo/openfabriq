import { HANDOFF_LABEL, HANDOFF_SUMMARY } from "@openfabriq/core";
import type { QueuedRun } from "../engine/queue.js";
import { errorText } from "../files.js";
import type { GitHub } from "../github/github.js";
import { sign } from "../github/markers.js";
import type { SourceWriter } from "./outputs/apply.js";
import type { Outcome } from "./outputs/review.js";

/** A failed hand-off is noted: it never replaces why the run stopped. */
async function attempt(
	outcome: Outcome,
	write: () => Promise<unknown>,
): Promise<Outcome> {
	try {
		const url = await write();
		return typeof url === "string" && url ? { ...outcome, url } : outcome;
	} catch (error) {
		return { ...outcome, status: "failed", reason: errorText(error) };
	}
}

/**
 * The run stops and says so where it writes: in its Slack, Linear or Sentry source, or on its
 * GitHub issue or pull request with the hand-off label. A run on the whole repository says nothing.
 */
export async function handOff(
	reason: string,
	to: {
		run: QueuedRun;
		repository: string;
		writer: SourceWriter | undefined;
		github: GitHub;
		/** The line saying openfabriq wrote it, on GitHub; absent when the factory turns it off. */
		credit?: string;
	},
	/** What a person needs to take over, under the sentence: the open findings of a review. */
	details?: string,
): Promise<Outcome[]> {
	const { run, repository: repo, writer, github, credit } = to;
	const text = `openfabriq stopped and hands this over to a human: ${reason}.${details ? `\n\n${details}` : ""}`;
	const comment: Outcome = {
		action: "add_comment",
		summary: HANDOFF_SUMMARY,
		status: "applied",
	};
	// A delegated Linear session ends with its own error activity instead.
	if (writer?.close) return [];
	if (writer?.comment) {
		const post = writer.comment.bind(writer);
		return [await attempt(comment, () => post(text))];
	}
	// A webhook has nowhere to answer: the app shows the run and why it stopped.
	if (writer) return [];
	const number = run.number;
	if (number === undefined) return [];
	return [
		await attempt(
			{ action: "add_labels", summary: HANDOFF_LABEL, status: "applied" },
			() => github.addLabels(repo, number, [HANDOFF_LABEL]),
		),
		await attempt(comment, () =>
			github.comment(
				repo,
				number,
				sign(credit ? `${text}\n\n${credit}` : text, run.id),
			),
		),
	];
}

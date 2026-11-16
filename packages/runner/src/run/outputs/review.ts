import {
	type Action,
	type Automation,
	includesName,
	misfit,
	sameName,
} from "@openfabriq/core";
import type { Proposal, Subject } from "./tools.js";

export interface Outcome {
	action: Action;
	summary: string;
	status: "applied" | "refused" | "failed";
	reason?: string;
	url?: string;
	/**
	 * create_pull_request and push_to_pull_request, applied: the files the run changed, so the studio
	 * tells which automations the pushed pull request starts. Absent past FILES_KEPT.
	 */
	files?: string[];
	/**
	 * create_pull_request and push_to_pull_request, applied: the commits the run pushed, so the
	 * studio tells a pull request merged as the factory wrote it.
	 */
	commits?: string[];
	/** remove_labels on GitHub, applied: the labels that were on it, so a precaution reads as such. */
	removed?: string[];
}

/**
 * What one run may write at most, whatever `can` says: an agent looping on a tool floods nobody,
 * and one run cannot fill the write queue every project shares.
 */
const PER_RUN: Partial<Record<Action, number>> = {
	create_issue: 5,
	add_comment: 10,
	request_changes: 3,
	add_labels: 5,
	remove_labels: 5,
	close_issue: 1,
	close_pr: 1,
};
/** Labels in one add_labels or remove_labels call, once each: remove_labels writes once per label. */
const MOST_LABELS = 20;
const onceEach = (labels: string[]) =>
	labels.filter((l, i) => labels.findIndex((m) => sameName(m, l)) === i);

export const summarize = (p: Proposal): string => {
	switch (p.action) {
		case "add_labels":
		case "remove_labels":
			return p.labels.join(", ");
		case "create_pull_request":
		case "create_issue":
			return p.title;
		case "push_to_pull_request":
			return p.summary;
		case "close_issue":
		case "close_pr":
		case "merge_pull_request":
			return "";
		default:
			return p.body.split("\n")[0]?.slice(0, 120) ?? "";
	}
};

/** Checks every proposal against `can`, whatever the agent did: the engine is the only one that writes. */
export function reviewProposals(
	proposals: Proposal[],
	automation: Automation,
	subject: Subject,
): { accepted: Proposal[]; refused: Outcome[] } {
	const accepted: Proposal[] = [];
	const refused: Outcome[] = [];
	const refuse = (p: Proposal, reason: string, summary = summarize(p)) =>
		refused.push({ action: p.action, summary, status: "refused", reason });
	for (const asked of proposals) {
		const proposal: Proposal =
			asked.action === "add_labels" || asked.action === "remove_labels"
				? { ...asked, labels: onceEach(asked.labels) }
				: asked;
		const permission = automation.can.find((p) => p.action === proposal.action);
		if (!permission) {
			refuse(proposal, `not allowed: ${proposal.action} is not in can`);
			continue;
		}
		const why = misfit(proposal.action, subject.kind);
		if (why) {
			refuse(proposal, why);
			continue;
		}
		if (
			proposal.action === "create_pull_request" &&
			accepted.some((p) => p.action === "create_pull_request")
		) {
			refuse(proposal, "one pull request per run");
			continue;
		}
		if (
			(proposal.action === "add_labels" ||
				proposal.action === "remove_labels") &&
			proposal.labels.length > MOST_LABELS
		) {
			refuse(proposal, `at most ${MOST_LABELS} labels per call`);
			continue;
		}
		const most = PER_RUN[proposal.action];
		if (
			most !== undefined &&
			accepted.filter((p) => p.action === proposal.action).length >= most
		) {
			refuse(proposal, `at most ${most} per run`);
			continue;
		}
		if (
			(proposal.action === "add_labels" ||
				proposal.action === "remove_labels") &&
			permission.labels
		) {
			const allowed = permission.labels;
			const ok = proposal.labels.filter((l) => includesName(allowed, l));
			const ko = proposal.labels.filter((l) => !includesName(allowed, l));
			if (ko.length)
				refuse(proposal, `not in can.${proposal.action}`, ko.join(", "));
			if (ok.length) accepted.push({ ...proposal, labels: ok });
			continue;
		}
		// The engine labels the issues it opens from can, never from the agent: its tools take no
		// labels. A pull request also keeps those of its internal review (withReview), the engine's.
		if (
			(proposal.action === "create_issue" ||
				proposal.action === "create_pull_request") &&
			permission.labels
		)
			accepted.push({
				...proposal,
				labels: [
					...new Set([
						...permission.labels,
						...(proposal.action === "create_pull_request"
							? (proposal.labels ?? [])
							: []),
					]),
				],
			});
		else accepted.push(proposal);
	}
	return { accepted, refused };
}

// A merge waits for the checks too: code that fails them is never merged.
const isCode = (p: Proposal) =>
	p.action === "create_pull_request" ||
	p.action === "push_to_pull_request" ||
	p.action === "merge_pull_request";

/**
 * Why the engine will not push commits that change a CI workflow, or undefined. A workflow can
 * read any secret of the repository and runs as soon as the branch is pushed.
 */
export function workflowChange(paths: string[]): string | undefined {
	const workflows = paths.filter((p) =>
		p.toLowerCase().startsWith(".github/workflows/"),
	);
	return workflows.length
		? `the commits change ${workflows.join(", ")}: CI workflows run with the repository's secrets, so a person makes this change`
		: undefined;
}

/** Why the engine will not publish the wiki agent's commits, or undefined: they stay in its folder. */
export function outsideWiki(
	paths: string[],
	folder: string,
): string | undefined {
	const outside = paths.filter((p) => !p.startsWith(`${folder}/`));
	return outside.length
		? `the wiki's commits change ${outside.join(", ")}, outside ${folder}/: the wiki's agent writes there only`
		: undefined;
}

/**
 * A failing check refuses the code proposals: the engine's own run of the checks decides,
 * never what the agent says. The run's comments and labels go with that code ("here is the fix",
 * a label removed because it is fixed): they are refused too, and the hand-off says why.
 */
export function gateOnChecks(
	reviewed: { accepted: Proposal[]; refused: Outcome[] },
	checkFailure: string | undefined,
): { accepted: Proposal[]; refused: Outcome[] } {
	if (!checkFailure || !reviewed.accepted.some(isCode)) return reviewed;
	return {
		accepted: [],
		refused: [
			...reviewed.refused,
			...reviewed.accepted.map(
				(p): Outcome => ({
					action: p.action,
					summary: summarize(p),
					status: "refused",
					reason: isCode(p)
						? checkFailure
						: `the code it goes with was refused: ${checkFailure}`,
				}),
			),
		],
	};
}

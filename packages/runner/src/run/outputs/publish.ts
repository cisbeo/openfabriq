import type { Automation, Factory } from "@openfabriq/core";
import type { QueuedRun } from "../../engine/queue.js";
import { credit } from "../../github/markers.js";
import { untrustedPushTo } from "../../state/journal.js";
import type { RunDeps, RunPaths } from "../execute.js";
import { branchName } from "../subject.js";
import { applyProposals, type SourceWriter } from "./apply.js";
import { applyMerge } from "./merge.js";
import type { Outcome } from "./review.js";
import type { Proposal, Subject } from "./tools.js";

/** More files than this, and the journal keeps none: the studio then shows every automation that may follow. */
const FILES_KEPT = 300;

const pushes = (o: Outcome) =>
	o.status === "applied" &&
	(o.action === "create_pull_request" || o.action === "push_to_pull_request");

export const AUTO_MERGE_STILL_ON =
	"GitHub kept the engine's auto-merge on, so the commits were not pushed: they would merge without a review";

/** The visible line under what the run writes on GitHub, unless the factory turned it off; the engine's own words have no agent. */
export function creditFor(
	run: QueuedRun,
	factory: Factory,
	defaultBranch: string,
	agent?: string,
): string | undefined {
	if (factory.signature === false) return undefined;
	const automation = factory.automations[run.automation];
	const builtIn =
		automation &&
		(automation.builtIn || factory.agents[automation.agent]?.builtIn);
	return credit({
		repository: factory.repository,
		defaultBranch,
		automation: run.automation,
		...(automation?.area ? { area: automation.area } : {}),
		...(agent ? { agent } : {}),
		...(builtIn ? { builtIn: true } : {}),
		runId: run.id,
	});
}

/** Where the accepted proposals go, and what they are written with: the run, its worktree, its source, its harness. */
export interface Publication {
	run: QueuedRun;
	factory: Factory;
	automation: Automation;
	deps: RunDeps;
	writer: SourceWriter | undefined;
	paths: RunPaths;
	ref: string;
	headRef?: string;
	data: Record<string, unknown>;
	subject: Subject;
	defaultBranch: string;
	/** The factory's checks on the reviewed commit, never in the agent's worktree. */
	checkReviewedCommit: () => Promise<string | undefined>;
	/** The commit judged: what is pushed. */
	judged?: string;
	/** An issue or a pull request was just opened, or a push to a pull request is about to be made. */
	opened?: (outcome: Outcome) => void;
}

/**
 * The accepted proposals, written: GitHub or the run's source first, then the merge, which may
 * wait for the run's labels and comment. Returns what each became.
 */
export async function applyOutputs(
	accepted: Proposal[],
	step: Publication,
): Promise<Outcome[]> {
	const { run, factory, automation, deps, writer, paths, ref } = step;
	const { github, workspace } = deps;
	const { clone, worktree } = paths;
	const repo = factory.repository;
	const signedBy = creditFor(
		run,
		factory,
		step.defaultBranch,
		automation.agent,
	);
	const merging = accepted.some((p) => p.action === "merge_pull_request");
	// The engine's push brings new commits: the auto-merge it turned on must wait for a new review.
	// Still on, the push would merge unreviewed: it is not made.
	const autoMergeStillOn =
		run.number !== undefined &&
		accepted.some((p) => p.action === "push_to_pull_request") &&
		deps.journal.engineMerges(repo).includes(run.number) &&
		!(await github.disableAutoMerge(repo, run.number).then(
			() => true,
			() => false,
		));
	const written = await applyProposals(
		accepted.filter((p) => p.action !== "merge_pull_request"),
		{
			repository: repo,
			runId: run.id,
			subject: step.subject,
			defaultBranch: step.defaultBranch,
			...(step.headRef ? { headRef: step.headRef } : {}),
			worktree,
			branchName: branchName(run, automation),
			...(writer ? { source: writer } : {}),
			...(run.untrusted ? { untrusted: true } : {}),
			...(signedBy ? { credit: signedBy } : {}),
			commitsAhead: (base) => workspace.commitsAhead(clone, worktree, base),
			push: (branch) => workspace.push(clone, worktree, branch, step.judged),
			...(step.opened ? { opened: step.opened } : {}),
			...(autoMergeStillOn ? { pushRefused: AUTO_MERGE_STILL_ON } : {}),
		},
		github,
	);
	const pushed = written.some(pushes);
	const files = pushed
		? await workspace.touched(clone, worktree, ref).catch(() => undefined)
		: undefined;
	const commits = pushed
		? await workspace
				.commitsSince(clone, worktree, ref, step.judged)
				.catch(() => undefined)
		: undefined;
	const applied = written.map((o) =>
		pushes(o)
			? {
					...o,
					...(files && files.length <= FILES_KEPT ? { files } : {}),
					...(commits?.length ? { commits } : {}),
				}
			: o,
	);
	const merge = automation.can.find(
		(p) => p.action === "merge_pull_request",
	)?.merge;
	if (!merging || !merge || run.number === undefined) return applied;
	const merged = await applyMerge(
		{
			repository: repo,
			number: run.number,
			defaultBranch: step.defaultBranch,
			conditions: merge,
			untrusted: run.untrusted ?? false,
			untrustedPush: untrustedPushTo(deps.journal.read(repo), run.number),
			maintainers: factory.maintainers,
			reviewed: (step.data.pull_request as Record<string, unknown>) ?? {},
			labels: mergeLabels(accepted, applied, run.event),
			agentChanged: async () => {
				const { uncommitted, ahead } = await workspace.changed(
					clone,
					worktree,
					ref,
				);
				return uncommitted || ahead > 0;
			},
			...(factory.checks?.length
				? { factoryChecks: step.checkReviewedCommit }
				: {}),
			remember: (number) => deps.journal.rememberMerge(repo, number),
		},
		github,
	);
	return [...applied, merged];
}

/**
 * The labels a merge may count on: those the run added, when all of them were applied, and the
 * label whose adding started the run.
 */
function mergeLabels(
	accepted: Proposal[],
	applied: Outcome[],
	event: QueuedRun["event"],
): string[] {
	const labeled = accepted.flatMap((p) =>
		p.action === "add_labels" ? p.labels : [],
	);
	const labelsApplied = applied.every(
		(o) => o.action !== "add_labels" || o.status === "applied",
	);
	return [
		...(labelsApplied ? labeled : []),
		...(event.event === "pull_request.labeled" && event.label
			? [event.label]
			: []),
	];
}

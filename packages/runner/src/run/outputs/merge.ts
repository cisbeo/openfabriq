import {
	includesName,
	type MergeConditions,
	matchesGlob,
} from "@openfabriq/core";
import { errorText } from "../../files.js";
import { checksState } from "../../github/checks.js";
import type { GitHub } from "../../github/github.js";
import { isFromUntrustedRun } from "../../github/markers.js";
import type { Workspace } from "../../workspace/workspace.js";
import type { Outcome } from "./review.js";

/** What the engine knows when an agent proposes to merge its run's pull request. */
export interface MergeFacts {
	/** Sentry, a webhook or a stranger started the run. */
	untrusted: boolean;
	/** The pull request comes from a fork. */
	fork: boolean;
	/** Opened by the engine for a run no maintainer started. */
	fromUntrustedRun: boolean;
	author: string;
	/** The maintainers, and the engine's own gh login. */
	trustedAuthors: string[];
	/** The head commit when the run started, and now. */
	reviewedSha: string;
	headSha: string;
	/** Every file the pull request changes; complete is false when GitHub cut the list. */
	files: string[];
	filesComplete: boolean;
	/** The labels this run added, and the label whose adding by a maintainer started it. */
	labels: string[];
	/** The agent left changes or commits in the worktree. */
	agentChanged: boolean;
	/** The factory's checks, run again on the reviewed commit; undefined when it has none. */
	factoryChecks?: { failure?: string };
	/** GitHub's checks on the head commit. */
	ci: "none" | "pending" | "failed" | "passed";
	/** GitHub holds the pull request back for the repository's rules (mergeStateStatus BLOCKED): its auto-merge waits for them. */
	blocked: boolean;
	defaultBranchRed: boolean;
}

/** Files a merge never brings in by itself: the CI and the factory. */
const LOCKED = [".github/workflows/**", "openfabriq/**"];

/** Why the engine does not merge, or undefined: the factory's conditions first, then the engine's locks. */
export function mergeRefusal(
	conditions: MergeConditions,
	facts: MergeFacts,
): string | undefined {
	return refusalBeforeChecks(conditions, facts) ?? refusalFromChecks(facts);
}

/** The refusals that come before the factory's checks: known without running them. */
function refusalBeforeChecks(
	conditions: MergeConditions,
	facts: Omit<MergeFacts, "factoryChecks">,
): string | undefined {
	if (facts.untrusted)
		return "a run started by Sentry, a webhook or a stranger never merges";
	if (facts.fork) return "the pull request comes from a fork";
	if (facts.fromUntrustedRun)
		return "the pull request comes from, or was pushed to by, a run no maintainer started";
	if (!includesName(facts.trustedAuthors, facts.author))
		return `the pull request was opened by ${facts.author}, not a maintainer`;
	if (!facts.reviewedSha || facts.headSha !== facts.reviewedSha)
		return "new commits arrived since the run started";
	if (facts.agentChanged)
		return "the agent changed the pull request: a merge takes only what was reviewed";
	if (!facts.filesComplete)
		return "the pull request changes too many files to check them all";
	const matches = (file: string, globs: string[]) =>
		globs.some((g) => matchesGlob(file, g));
	if (
		conditions.labels &&
		!conditions.labels.some((l) => includesName(facts.labels, l))
	)
		return `none of the labels ${conditions.labels.join(", ")} was added by this run or by the maintainer who started it`;
	const outside = conditions.only_paths
		? facts.files.filter((f) => !matches(f, conditions.only_paths ?? []))
		: [];
	if (outside.length)
		return `${outside[0]} is outside only_paths (${conditions.only_paths?.join(", ")})`;
	const excluded = facts.files.find((f) =>
		matches(f, conditions.except_paths ?? []),
	);
	if (excluded)
		return `${excluded} matches except_paths (${conditions.except_paths?.join(", ")})`;
	const locked = facts.files.find((f) => matches(f, LOCKED));
	if (locked)
		return `${locked} changes the CI or the factory, which a person merges`;
	return undefined;
}

/** The refusals from the checks: the factory's, then GitHub's, then the default branch's. */
function refusalFromChecks(facts: MergeFacts): string | undefined {
	if (facts.factoryChecks?.failure) return facts.factoryChecks.failure;
	if (facts.ci === "failed") return "a check of the pull request failed";
	// Auto-merge waits only for required checks: with none, it would merge before the others end.
	if (facts.ci === "pending" && !facts.blocked)
		return "checks are still running and the repository requires none of them: GitHub's auto-merge would not wait for them";
	if (facts.ci === "none" && !facts.factoryChecks)
		return "nothing checked this commit: no check on GitHub, and no checks in the factory";
	if (facts.defaultBranchRed)
		return "the checks of the default branch are failing";
	return undefined;
}

/** What the run gives the merge: its pull request as it was read at the start, and how to check the rest now. */
export interface MergeRun {
	repository: string;
	number: number;
	defaultBranch: string;
	conditions: MergeConditions;
	untrusted: boolean;
	/** A run no maintainer started pushed to this pull request. */
	untrustedPush: boolean;
	maintainers: string[];
	/** The pull request read when the run started. */
	reviewed: Record<string, unknown>;
	/** Labels this run added, and the label whose adding by a maintainer started it. */
	labels: string[];
	agentChanged: () => Promise<boolean>;
	/** The factory's checks, run again; undefined when it has none. */
	factoryChecks?: () => Promise<string | undefined>;
	/** Notes the pull request the engine merges: its merge commit starts no automation. */
	remember: (number: number) => void;
}

/** Decides and merges: the engine reads the pull request again, checks every condition, then asks gh. */
export async function applyMerge(
	run: MergeRun,
	github: GitHub,
): Promise<Outcome> {
	const outcome = (
		status: Outcome["status"],
		summary: string,
		reason?: string,
	): Outcome => ({
		action: "merge_pull_request",
		summary,
		status,
		...(reason ? { reason } : {}),
	});
	try {
		const now = await github.subject(run.repository, run.number, true);
		const files = (now.files as { path: string }[] | undefined) ?? [];
		const ci = checksState(now.statusCheckRollup);
		const known: Omit<MergeFacts, "factoryChecks"> = {
			untrusted: run.untrusted,
			fork: now.isCrossRepository === true,
			fromUntrustedRun:
				run.untrustedPush || isFromUntrustedRun(String(now.body ?? "")),
			author: String(
				(now.author as { login?: string } | undefined)?.login ?? "",
			),
			trustedAuthors: [...run.maintainers, await github.currentUser()],
			reviewedSha: String(run.reviewed.headRefOid ?? ""),
			headSha: String(now.headRefOid ?? ""),
			files: files.map((f) => f.path),
			filesComplete: files.length >= Number(now.changedFiles ?? 0),
			labels: run.labels,
			agentChanged: await run.agentChanged(),
			ci,
			blocked: now.mergeStateStatus === "BLOCKED",
			defaultBranchRed: await github.branchRed(
				run.repository,
				run.defaultBranch,
			),
		};
		// The factory's checks take minutes of setup: not run when the merge is refused anyway.
		const early = refusalBeforeChecks(run.conditions, known);
		if (early) return outcome("refused", "not merged", early);
		const failure = run.factoryChecks && (await run.factoryChecks());
		const facts: MergeFacts = {
			...known,
			...(run.factoryChecks
				? {
						factoryChecks: failure ? { failure } : {},
						// The checks took minutes: the default branch may have turned red meanwhile.
						defaultBranchRed: await github.branchRed(
							run.repository,
							run.defaultBranch,
						),
					}
				: {}),
		};
		const refusal = mergeRefusal(run.conditions, facts);
		if (refusal) return outcome("refused", "not merged", refusal);
		const method = await github.mergeMethod(run.repository);
		if (!method)
			return outcome(
				"refused",
				"not merged",
				"the repository allows no merge method",
			);
		// Checks still running: GitHub merges once the required ones pass, and a new commit cancels it.
		const auto = ci === "pending";
		await github.merge(run.repository, run.number, {
			sha: facts.headSha,
			method,
			auto,
		});
		run.remember(run.number);
		return outcome(
			"applied",
			auto
				? `auto-merge on (${method}): GitHub merges when the checks pass`
				: `merged (${method})`,
		);
	} catch (error) {
		return outcome("failed", "not merged", errorText(error));
	}
}

/**
 * Why the engine does not push a conflict's resolution, or undefined: the branch must contain its
 * base as it was when the run started, with no conflict marker left. Without the lock, a
 * bad resolution would push a commit still in conflict, which would start the run again.
 */
export async function unresolvedConflict(
	workspace: Pick<Workspace, "contains" | "conflictMarkers">,
	clone: string,
	dir: string,
	{ base, files }: { base: string; files: string[] },
): Promise<string | undefined> {
	if (!(await workspace.contains(clone, dir, base)))
		return `the conflict is not resolved: the branch does not contain ${base}; merge origin/${base}`;
	const left = await workspace.conflictMarkers(clone, dir, files);
	if (left.length) return `conflict markers are left in ${left.join(", ")}`;
	return undefined;
}

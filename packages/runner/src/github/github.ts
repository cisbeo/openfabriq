import type { IssueItem, TimelineItem } from "./timeline.js";

export interface OpenPull {
	number: number;
	sha: string;
	/** Who opened it: the actor of its pushes and failed checks. */
	author: string;
	/** `statusCheckRollup`: the checks of the head commit, read with failedChecks. */
	checks: unknown;
	/** Opened by the engine for a run no maintainer started. */
	fromUntrustedRun?: boolean;
	/** GitHub's word on merging it: MERGEABLE, CONFLICTING, or UNKNOWN while it computes. */
	mergeable?: string;
	/** Its base branch. */
	base?: string;
	/** GitHub's auto-merge is on for it. */
	autoMerge?: boolean;
}

export interface Review {
	state: string;
	body: string | null;
	user: { login: string } | null;
}

/** What the engine needs from GitHub. The real one calls the user's logged-in gh CLI. */
export interface GitHub {
	currentUser(): Promise<string>;
	defaultBranch(repository: string): Promise<string>;
	labels(repository: string): Promise<string[]>;
	createLabel(repository: string, name: string): Promise<void>;
	clone(repository: string, dir: string): Promise<void>;
	// Watching
	issuesUpdatedSince(repository: string, since: string): Promise<IssueItem[]>;
	timeline(repository: string, number: number): Promise<TimelineItem[]>;
	openPulls(repository: string): Promise<OpenPull[]>;
	commitAuthor(repository: string, sha: string): Promise<string>;
	branchHead(repository: string, branch: string): Promise<string>;
	/** The paths a pull request changes, for ignore_paths. */
	changedFiles(repository: string, number: number): Promise<string[]>;
	/** The paths new commits change (`before..after`), or undefined when GitHub cuts the list. */
	commitFiles(
		repository: string,
		commits: string,
	): Promise<string[] | undefined>;
	// Reading for a run
	jobLog(repository: string, jobId: string): Promise<string>;
	subject(
		repository: string,
		number: number,
		isPullRequest: boolean,
	): Promise<Record<string, unknown>>;
	reviews(repository: string, number: number): Promise<Review[]>;
	// Writing, only from the engine
	comment(repository: string, number: number, body: string): Promise<string>;
	addLabels(
		repository: string,
		number: number,
		labels: string[],
	): Promise<void>;
	/** Whether the label was on it: an absent label is no error. */
	removeLabel(
		repository: string,
		number: number,
		label: string,
	): Promise<boolean>;
	createPullRequest(
		repository: string,
		pull: { title: string; body: string; head: string; base: string },
	): Promise<string>;
	review(
		repository: string,
		number: number,
		body: string,
		changesRequested: boolean,
	): Promise<string>;
	createIssue(
		repository: string,
		issue: { title: string; body: string; labels?: string[] },
	): Promise<string>;
	/** For an issue, `reason` is GitHub's state reason: completed when left out. */
	close(
		repository: string,
		number: number,
		isPullRequest: boolean,
		reason?: CloseReason,
	): Promise<void>;
	// Merging under conditions
	/** The first merge method the repository allows: squash, then merge, then rebase. */
	mergeMethod(repository: string): Promise<MergeMethod | undefined>;
	/** Whether the checks of a branch's head commit are failing. */
	branchRed(repository: string, branch: string): Promise<boolean>;
	/** Merges the pull request at this commit, or lets GitHub merge it once its required checks pass. */
	merge(
		repository: string,
		number: number,
		options: { sha: string; method: MergeMethod; auto: boolean },
	): Promise<void>;
	/** Turns GitHub's auto-merge off: new commits need a new review. */
	disableAutoMerge(repository: string, number: number): Promise<void>;
}

export type MergeMethod = "squash" | "merge" | "rebase";

/** GitHub's state reasons for closing an issue. */
export const CLOSE_REASONS = ["completed", "not_planned", "duplicate"] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

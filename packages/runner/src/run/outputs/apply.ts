import { sameName, type ToolSummary } from "@openfabriq/core";
import { errorText } from "../../files.js";
import type { GitHub } from "../../github/github.js";
import {
	sign,
	signChangesRequested,
	withoutCredit,
} from "../../github/markers.js";
import type { RunRecord } from "../../state/journal.js";
import { type Outcome, summarize } from "./review.js";
import type { Proposal, Subject } from "./tools.js";

/** Where a Slack or Linear run writes its comments and labels, and the PR link notice. */
export interface SourceWriter {
	/**
	 * Absent for a webhook: it has nowhere to answer. `delivers`: the run also opens a
	 * pull request or an issue, so the comment is not a question waiting for an answer.
	 */
	comment?(
		body: string,
		options?: { delivers: boolean },
	): Promise<string | undefined>;
	changeLabels?(change: { add?: string[]; remove?: string[] }): Promise<void>;
	/** Put at the start of a pull request title: the Linear identifier. */
	titlePrefix?: string;
	/** Added to the body of the issues and pull requests the run opens: a link back to the source. */
	bodyFooter?: string;
	/** A delegated Linear session shows the links of the run's pull request and issue, instead of a comment. */
	link?(what: string, url: string): Promise<void>;
	/** Called when the run starts working, after its limits. */
	start?(): Promise<void>;
	/** One step of the agent, as it works. Never throws, never waits. */
	step?(step: ToolSummary): void;
	/** The run ended: the source says how, in the engine's own words. */
	close?(record: RunRecord): Promise<void>;
}

export interface ApplyContext {
	repository: string;
	runId: string;
	subject: Subject;
	defaultBranch: string;
	/** Same-repository head branch of the pull request, when the subject is one. */
	headRef?: string;
	worktree?: string;
	branchName: string;
	/** Slack or Linear: where comments and labels go, and where the PR link is posted. */
	source?: SourceWriter;
	/** No maintainer started the run: its writes are signed so. */
	untrusted?: boolean;
	/** The line under what the run writes on GitHub, saying openfabriq wrote it; absent when the factory turns it off. */
	credit?: string;
	commitsAhead(base: string): Promise<number>;
	push(branch: string): Promise<void>;
	/** Why the engine makes no push to the pull request, decided before the run's outputs. */
	pushRefused?: string;
	/** An issue or a pull request was just opened, or a push to a pull request is about to be made: the journal learns it before anything else happens. */
	opened?(outcome: Outcome): void;
}

/**
 * Applies accepted proposals in order. A failure is noted and the next proposals still run, except
 * label removals after a failed push or pull request: they would say the run's work landed.
 */
export async function applyProposals(
	accepted: Proposal[],
	ctx: ApplyContext,
	github: GitHub,
): Promise<Outcome[]> {
	const outcomes: Outcome[] = [];
	const { repository: repo, runId } = ctx;
	const untrusted = ctx.untrusted ?? false;
	const signed = (body: string, mark = sign) =>
		mark(
			ctx.credit
				? `${withoutCredit(body)}\n\n${ctx.credit}`
				: withoutCredit(body),
			runId,
			untrusted,
		);
	const number = ctx.subject.number ?? 0;
	const delivers = accepted.some(
		(p) => p.action === "create_pull_request" || p.action === "create_issue",
	);
	// Closing comes last, after the comment that explains it.
	const isClose = (p: Proposal) =>
		p.action === "close_issue" || p.action === "close_pr";
	// An issue comes first: the pull request of the same run then names it, and GitHub links them.
	const isIssue = (p: Proposal) => p.action === "create_issue";
	// Removals come after the push or the pull request: a run removes the label that started it once its work landed.
	const isRemoval = (p: Proposal) => p.action === "remove_labels";
	const ordered = [
		...accepted.filter(isIssue),
		...accepted.filter((p) => !isClose(p) && !isIssue(p) && !isRemoval(p)),
		...accepted.filter(isRemoval),
		...accepted.filter(isClose),
	];
	// A label the run also adds stays: a review takes its old verdict off and puts the same one back.
	const added = new Set(
		accepted.flatMap((p) => (p.action === "add_labels" ? p.labels : [])),
	);
	let undelivered: string | undefined;
	const issuesOpened: string[] = [];
	// The engine's link comments come after the run's own answer, which often announces them.
	const notices: [Proposal["action"], string][] = [];
	for (const p of ordered) {
		const outcome: Outcome = {
			action: p.action,
			summary: summarize(p),
			status: "applied",
		};
		try {
			switch (p.action) {
				case "add_comment": {
					const url = ctx.source
						? await sourceComment(ctx.source)(p.body, { delivers })
						: await github.comment(repo, number, signed(p.body));
					if (url) outcome.url = url;
					break;
				}
				case "add_labels":
					if (ctx.source) await sourceLabels(ctx.source)({ add: p.labels });
					else await github.addLabels(repo, number, p.labels);
					break;
				case "remove_labels":
					if (undelivered)
						throw new Error(
							`not removed: the ${undelivered} failed, and the labels say the work still waits`,
						);
					if (ctx.source) await sourceLabels(ctx.source)({ remove: p.labels });
					else {
						outcome.removed = [];
						for (const label of p.labels.filter((l) => !added.has(l)))
							if (await github.removeLabel(repo, number, label))
								outcome.removed.push(label);
					}
					break;
				case "request_changes":
					outcome.url = await github.review(
						repo,
						number,
						signed(p.body, signChangesRequested),
						true,
					);
					break;
				case "create_issue":
					outcome.url = await github.createIssue(repo, {
						title: p.title,
						body: signed(withFooter(p.body, ctx.source)),
						...(p.labels ? { labels: p.labels } : {}),
					});
					issuesOpened.push(outcome.url);
					ctx.opened?.({ ...outcome });
					break;
				case "create_pull_request": {
					if ((await ctx.commitsAhead(ctx.defaultBranch)) === 0)
						throw new Error("no commit to open a pull request with");
					await ctx.push(ctx.branchName);
					const prefix = ctx.source?.titlePrefix;
					outcome.url = await github.createPullRequest(repo, {
						title:
							prefix && !p.title.includes(prefix)
								? `${prefix}: ${p.title}`
								: p.title,
						body: signed(
							withFooter(
								issuesOpened.length
									? `${p.body}\n\nThis run also opened ${issuesOpened.join(", ")}`
									: p.body,
								ctx.source,
							),
						),
						head: ctx.branchName,
						base: ctx.defaultBranch,
					});
					ctx.opened?.({ ...outcome });
					// GitHub opens a pull request without labels: they go on it right after. The pull
					// request exists either way: a failure here leaves it applied, with why.
					const opened = Number(/\/(\d+)$/.exec(outcome.url)?.[1]);
					if (p.labels?.length && opened)
						await github.addLabels(repo, opened, p.labels).catch((error) => {
							outcome.reason = `the labels ${p.labels?.join(", ")} were not added: ${errorText(error)}`;
						});
					break;
				}
				case "close_issue":
					await github.close(repo, number, false, p.reason);
					break;
				case "close_pr":
					await github.close(repo, number, true);
					break;
				case "push_to_pull_request": {
					if (ctx.pushRefused) throw new Error(ctx.pushRefused);
					if (!ctx.headRef)
						throw new Error(
							"this pull request comes from a fork; the engine cannot push to it",
						);
					// A pull request from the default branch: a push would land there without any merge check.
					if (sameName(ctx.headRef, ctx.defaultBranch))
						throw new Error(
							`this pull request's branch is ${ctx.defaultBranch}, the default branch: the engine never pushes to it`,
						);
					if ((await ctx.commitsAhead(ctx.headRef)) === 0)
						throw new Error("no new commit to push");
					// Journaled before the push: a poll that sees the new head, or a restart after it, knows
					// which run pushed, and a run no maintainer started keeps its pull request untrusted.
					ctx.opened?.({ ...outcome });
					await ctx.push(ctx.headRef);
					break;
				}
			}
		} catch (error) {
			outcome.status = "failed";
			outcome.reason = errorText(error);
			if (p.action === "push_to_pull_request") undelivered = "push";
			if (p.action === "create_pull_request") undelivered = "pull request";
		}
		outcomes.push(outcome);
		// The engine's own notice, like needs-human: the link goes where the request was made.
		if (
			ctx.source &&
			outcome.status === "applied" &&
			outcome.url &&
			(p.action === "create_pull_request" || p.action === "create_issue")
		) {
			// A Linear session shows its links beside its answer: they go at once.
			if (ctx.source.link) {
				const sent = await notice(ctx.source, p.action, outcome.url);
				if (sent) outcomes.push(sent);
			} else notices.push([p.action, outcome.url]);
		}
	}
	for (const [action, url] of notices) {
		if (!ctx.source) break;
		const sent = await notice(
			ctx.source,
			action as "create_pull_request" | "create_issue",
			url,
		);
		if (sent) outcomes.push(sent);
	}
	return outcomes;
}

function sourceComment(source: SourceWriter) {
	if (!source.comment) throw new Error("this source has nowhere to answer");
	return source.comment.bind(source);
}

const withFooter = (body: string, source?: SourceWriter) =>
	source?.bodyFooter ? `${body}\n\n${source.bodyFooter}` : body;

function sourceLabels(source: SourceWriter) {
	if (!source.changeLabels) throw new Error("this source has no labels");
	return source.changeLabels.bind(source);
}

async function notice(
	source: SourceWriter,
	action: "create_pull_request" | "create_issue",
	url: string,
): Promise<Outcome | undefined> {
	const what = action === "create_pull_request" ? "Pull request" : "Issue";
	const { link, comment } = source;
	if (!link && !comment) return undefined;
	// The engine's note, never `action`: recorded as one, a pull request would count twice.
	const outcome: Outcome = link
		? {
				action: "add_comment",
				summary: `link to the ${what.toLowerCase()} in the session`,
				status: "applied",
			}
		: {
				action: "add_comment",
				summary: `link to the ${what.toLowerCase()}`,
				status: "applied",
			};
	try {
		if (link) await link(what, url);
		else {
			const posted = await comment?.(`${what} opened: ${url}`);
			if (posted) outcome.url = posted;
		}
	} catch (error) {
		outcome.status = "failed";
		outcome.reason = errorText(error);
	}
	return outcome;
}

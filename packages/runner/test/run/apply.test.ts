import { describe, expect, it } from "vitest";
import type { GitHub } from "../../src/github/github.js";
import {
	type ApplyContext,
	applyProposals,
} from "../../src/run/outputs/apply.js";

const context = (headRef: string, pushed: string[]): ApplyContext => ({
	repository: "acme/web-app",
	runId: "run-1",
	subject: { number: 4, kind: "pull_request" },
	defaultBranch: "main",
	headRef,
	branchName: "openfabriq/run-1",
	commitsAhead: async () => 1,
	push: async (branch) => {
		pushed.push(branch);
	},
});
const push = [{ action: "push_to_pull_request" as const, summary: "Fix" }];

it("pushes to a pull request's branch, never to the default branch it may come from", async () => {
	const pushed: string[] = [];
	const github = {} as GitHub;
	expect(
		await applyProposals(push, context("feature", pushed), github),
	).toEqual([expect.objectContaining({ status: "applied" })]);
	for (const head of ["main", "Main"])
		expect(await applyProposals(push, context(head, pushed), github)).toEqual([
			expect.objectContaining({
				status: "failed",
				reason: expect.stringContaining("the default branch"),
			}),
		]);
	expect(pushed).toEqual(["feature"]);
});

it("closes an issue with the reason the agent gave: a duplicate is not completed work", async () => {
	const closed: unknown[][] = [];
	const github = {
		close: async (...args: unknown[]) => {
			closed.push(args);
		},
	} as unknown as GitHub;
	const issue = {
		...context("feature", []),
		subject: { number: 31, kind: "issue" as const },
	};
	await applyProposals(
		[{ action: "close_issue", reason: "duplicate" }],
		issue,
		github,
	);
	await applyProposals([{ action: "close_issue" }], issue, github);
	expect(closed).toEqual([
		["acme/web-app", 31, false, "duplicate"],
		["acme/web-app", 31, false, undefined],
	]);
});

describe("a push that fails keeps the labels the run would remove", () => {
	const labels = (writes: string[]) =>
		({
			comment: async (_repo: string, n: number, body: string) => {
				writes.push(`comment #${n}: ${body.split("\n")[0]}`);
				return "https://github.com/acme/web-app/pull/4#c";
			},
			addLabels: async (_repo: string, n: number, added: string[]) => {
				writes.push(`add #${n}: ${added.join(", ")}`);
			},
			removeLabel: async (_repo: string, n: number, label: string) => {
				writes.push(`remove #${n}: ${label}`);
			},
			createPullRequest: async () => {
				throw new Error("gh: HTTP 502");
			},
		}) as unknown as GitHub;
	const rework = [
		{ action: "remove_labels" as const, labels: ["changes-requested"] },
		{ action: "push_to_pull_request" as const, summary: "Fix the loss" },
		{ action: "add_labels" as const, labels: ["needs-human"] },
		{ action: "add_comment" as const, body: "Fixed." },
	];

	it("on a rejected push: the labels it would remove stay, the ones it adds for a person go on", async () => {
		const writes: string[] = [];
		const outcomes = await applyProposals(
			rework,
			{
				...context("feature", []),
				push: async () => {
					throw new Error("rejected: the branch moved");
				},
			},
			labels(writes),
		);
		expect(writes).toEqual(["add #4: needs-human", "comment #4: Fixed."]);
		expect(outcomes).toContainEqual(
			expect.objectContaining({
				action: "remove_labels",
				status: "failed",
				reason: expect.stringContaining("the push failed"),
			}),
		);
	});

	it("on a push the engine refused before the outputs, the same", async () => {
		const writes: string[] = [];
		const pushed: string[] = [];
		const outcomes = await applyProposals(
			rework,
			{ ...context("feature", pushed), pushRefused: "auto-merge still on" },
			labels(writes),
		);
		expect(pushed).toEqual([]);
		expect(writes).toEqual(["add #4: needs-human", "comment #4: Fixed."]);
		expect(outcomes).toContainEqual(
			expect.objectContaining({
				action: "push_to_pull_request",
				status: "failed",
				reason: "auto-merge still on",
			}),
		);
	});

	it("on a pull request that could not be opened, the ticket keeps ready-for-agent", async () => {
		const writes: string[] = [];
		await applyProposals(
			[
				{ action: "remove_labels", labels: ["ready-for-agent"] },
				{ action: "create_pull_request", title: "T1", body: "Builds T1" },
			],
			{
				...context("feature", []),
				subject: { number: 12, kind: "issue" },
			},
			labels(writes),
		);
		expect(writes).toEqual([]);
	});

	it("after a push that landed, the labels go", async () => {
		const writes: string[] = [];
		await applyProposals(rework, context("feature", []), labels(writes));
		expect(writes).toEqual([
			"add #4: needs-human",
			"comment #4: Fixed.",
			"remove #4: changes-requested",
		]);
	});
});

it("says which labels it really removed: a review's precaution on labels that are not there removes none", async () => {
	const on = new Set(["risk:low"]);
	const github = {
		removeLabel: async (_repo: string, _n: number, label: string) =>
			on.delete(label),
	} as unknown as GitHub;
	const remove = (labels: string[]) =>
		applyProposals(
			[{ action: "remove_labels", labels }],
			context("feature", []),
			github,
		);
	expect(await remove(["needs-human", "risk:low", "risk:high"])).toEqual([
		expect.objectContaining({
			status: "applied",
			summary: "needs-human, risk:low, risk:high",
			removed: ["risk:low"],
		}),
	]);
	expect(await remove(["needs-human", "risk:low"])).toEqual([
		expect.objectContaining({ status: "applied", removed: [] }),
	]);
});

it("keeps a label the same run adds again: a review's new verdict is not taken off and put back", async () => {
	const on = new Set(["needs-human", "risk:high", "changes-requested"]);
	const writes: string[] = [];
	const github = {
		removeLabel: async (_repo: string, _n: number, label: string) => {
			writes.push(`remove ${label}`);
			return on.delete(label);
		},
		addLabels: async (_repo: string, _n: number, labels: string[]) => {
			writes.push(`add ${labels.join(", ")}`);
		},
	} as unknown as GitHub;
	const outcomes = await applyProposals(
		[
			{
				action: "remove_labels",
				labels: ["needs-human", "risk:high", "changes-requested"],
			},
			{ action: "add_labels", labels: ["risk:high", "needs-human"] },
		],
		context("feature", []),
		github,
	);
	expect(writes).toEqual([
		"add risk:high, needs-human",
		"remove changes-requested",
	]);
	expect(outcomes).toContainEqual(
		expect.objectContaining({
			action: "remove_labels",
			removed: ["changes-requested"],
		}),
	);
});

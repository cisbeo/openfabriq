import type { Automation } from "@openfabriq/core";
import { expect, it } from "vitest";
import { reviewProposals } from "../../src/run/outputs/review.js";
import type { Proposal } from "../../src/run/outputs/tools.js";

const automation = (can: Automation["can"]) =>
	({
		name: "triage",
		when: [],
		agent: "triager",
		can,
	}) as unknown as Automation;
const times = <T>(n: number, p: T): T[] => Array.from({ length: n }, () => p);
const many = (n: number, p: Proposal): Proposal[] => times(n, p);
const count = (ps: { action: string }[], action: string) =>
	ps.filter((p) => p.action === action).length;

it("caps every write a run proposes, not only issues and comments", () => {
	const proposals: Proposal[] = [
		...many(200, { action: "add_labels", labels: ["bug"] }),
		...many(200, { action: "remove_labels", labels: ["needs-info"] }),
		...many(200, { action: "close_issue" }),
	];
	const { accepted, refused } = reviewProposals(
		proposals,
		automation([
			{ action: "add_labels" },
			{ action: "remove_labels", labels: ["needs-info"] },
			{ action: "close_issue" },
		]),
		{ kind: "issue", number: 5 },
	);
	expect(count(accepted, "add_labels")).toBe(5);
	expect(count(accepted, "remove_labels")).toBe(5);
	expect(count(accepted, "close_issue")).toBe(1);
	expect(refused.find((o) => o.action === "close_issue")?.reason).toBe(
		"at most 1 per run",
	);
});

it("caps change requests and closing a pull request", () => {
	const { accepted } = reviewProposals(
		[
			...many(200, { action: "request_changes", body: "fix" }),
			...many(3, { action: "close_pr" }),
		],
		automation([{ action: "request_changes" }, { action: "close_pr" }]),
		{ kind: "pull_request", number: 9 },
	);
	expect(count(accepted, "request_changes")).toBe(3);
	expect(count(accepted, "close_pr")).toBe(1);
});

it("writes each label once, and refuses a call with too many", () => {
	const { accepted, refused } = reviewProposals(
		[
			{ action: "remove_labels", labels: times(1000, "needs-info") },
			{ action: "add_labels", labels: ["bug", "Bug", "ui"] },
			{
				action: "add_labels",
				labels: Array.from({ length: 21 }, (_, i) => `l${i}`),
			},
		],
		automation([
			{ action: "remove_labels", labels: ["needs-info"] },
			{ action: "add_labels" },
		]),
		{ kind: "issue", number: 5 },
	);
	expect(accepted).toEqual([
		{ action: "remove_labels", labels: ["needs-info"] },
		{ action: "add_labels", labels: ["bug", "ui"] },
	]);
	expect(refused).toEqual([
		expect.objectContaining({
			action: "add_labels",
			reason: "at most 20 labels per call",
		}),
	]);
});

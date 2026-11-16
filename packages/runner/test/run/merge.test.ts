import { describe, expect, it } from "vitest";
import { checksState } from "../../src/github/checks.js";
import type { GitHub } from "../../src/github/github.js";
import {
	applyMerge,
	type MergeFacts,
	mergeRefusal,
} from "../../src/run/outputs/merge.js";

const facts = (over: Partial<MergeFacts> = {}): MergeFacts => ({
	untrusted: false,
	fork: false,
	fromUntrustedRun: false,
	author: "alice",
	trustedAuthors: ["alice", "engine-bot"],
	reviewedSha: "abc",
	headSha: "abc",
	files: ["src/content/blog/hello.md"],
	filesComplete: true,
	labels: [],
	agentChanged: false,
	ci: "passed",
	blocked: false,
	defaultBranchRed: false,
	...over,
});

describe("the merge decision", () => {
	it("merges when the factory's conditions and the engine's locks hold", () => {
		expect(
			mergeRefusal({ only_paths: ["src/content/**"] }, facts()),
		).toBeUndefined();
		expect(
			mergeRefusal({ labels: ["risk:low"] }, facts({ labels: ["Risk:Low"] })),
		).toBeUndefined();
		expect(
			mergeRefusal({ except_paths: ["src/auth/**"] }, facts()),
		).toBeUndefined();
	});

	it.each<
		[string, Parameters<typeof mergeRefusal>[0], Partial<MergeFacts>, string]
	>([
		[
			"an untrusted run",
			{ only_paths: ["**"] },
			{ untrusted: true },
			"never merges",
		],
		["a fork", { only_paths: ["**"] }, { fork: true }, "fork"],
		[
			"a pull request from an untrusted run",
			{ only_paths: ["**"] },
			{ fromUntrustedRun: true },
			"no maintainer",
		],
		[
			"a stranger's pull request",
			{ only_paths: ["**"] },
			{ author: "mallory" },
			"opened by mallory",
		],
		[
			"a commit pushed during the review",
			{ only_paths: ["**"] },
			{ headSha: "def" },
			"new commits",
		],
		[
			"an agent that changed the pull request",
			{ only_paths: ["**"] },
			{ agentChanged: true },
			"changed the pull request",
		],
		[
			"a list of files GitHub cut",
			{ only_paths: ["**"] },
			{ filesComplete: false },
			"too many files",
		],
		[
			"no label",
			{ labels: ["risk:low"] },
			{ labels: ["risk:high"] },
			"none of the labels risk:low",
		],
		[
			"a file outside only_paths",
			{ only_paths: ["src/content/**"] },
			{ files: ["src/content/a.md", "src/app.ts"] },
			"src/app.ts is outside only_paths",
		],
		[
			"a file in except_paths",
			{ except_paths: ["migrations/**"] },
			{ files: ["migrations/001.sql"] },
			"migrations/001.sql matches except_paths",
		],
		[
			"a workflow",
			{ only_paths: ["**"] },
			{ files: [".github/workflows/ci.yml"] },
			"changes the CI or the factory",
		],
		[
			"the factory",
			{ only_paths: ["**"] },
			{ files: ["openfabriq/factory.yaml"] },
			"changes the CI or the factory",
		],
		[
			"a failing factory check",
			{ only_paths: ["**"] },
			{ factoryChecks: { failure: 'the check "test" failed (pnpm test)' } },
			'the check "test" failed',
		],
		[
			"a failed CI",
			{ only_paths: ["**"] },
			{ ci: "failed" },
			"a check of the pull request failed",
		],
		[
			"nothing that checked the commit",
			{ only_paths: ["**"] },
			{ ci: "none" },
			"nothing checked this commit",
		],
		[
			"an unknown reviewed commit",
			{ only_paths: ["**"] },
			{ reviewedSha: "", headSha: "" },
			"new commits",
		],
		[
			"running checks the repository does not require",
			{ only_paths: ["**"] },
			{ ci: "pending", blocked: false },
			"requires none of them",
		],
		[
			"a red default branch",
			{ only_paths: ["**"] },
			{ defaultBranchRed: true },
			"default branch are failing",
		],
	])("refuses %s", (_, conditions, over, reason) => {
		expect(mergeRefusal(conditions, facts(over))).toContain(reason);
	});

	it("lets GitHub's auto-merge wait for checks the repository requires", () => {
		expect(
			mergeRefusal(
				{ only_paths: ["**"] },
				facts({ ci: "pending", blocked: true }),
			),
		).toBeUndefined();
	});

	it("accepts a commit only the factory's checks verified", () => {
		expect(
			mergeRefusal(
				{ only_paths: ["**"] },
				facts({ ci: "none", factoryChecks: {} }),
			),
		).toBeUndefined();
	});
});

describe("checksState", () => {
	it("tells no check, running, failed and passed apart", () => {
		expect(checksState([])).toBe("none");
		expect(checksState(undefined)).toBe("none");
		expect(checksState([{ name: "ci", status: "IN_PROGRESS" }])).toBe(
			"pending",
		);
		expect(
			checksState([{ name: "ci", status: "COMPLETED", conclusion: "FAILURE" }]),
		).toBe("failed");
		expect(
			checksState([
				{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" },
				{ __typename: "StatusContext", context: "deploy", state: "SUCCESS" },
			]),
		).toBe("passed");
	});

	it("tells a failure as soon as a check finished failing, even while another runs", () => {
		expect(
			checksState([
				{ name: "lint", status: "COMPLETED", conclusion: "FAILURE" },
				{ name: "ci", status: "IN_PROGRESS" },
			]),
		).toBe("failed");
		expect(
			checksState([
				{ __typename: "StatusContext", context: "deploy", state: "ERROR" },
				{ __typename: "StatusContext", context: "ci", state: "PENDING" },
			]),
		).toBe("failed");
		// A check run that has not completed is running, whatever its conclusion says.
		expect(
			checksState([
				{ name: "ci", status: "IN_PROGRESS", conclusion: "FAILURE" },
			]),
		).toBe("pending");
	});
});

describe("applyMerge", () => {
	const pullRequest = (over: Record<string, unknown>) =>
		({
			subject: async () => ({
				isCrossRepository: false,
				body: "",
				author: { login: "alice" },
				headRefOid: "abc",
				files: [{ path: "docs/a.md" }],
				changedFiles: 1,
				statusCheckRollup: [],
				...over,
			}),
			currentUser: async () => "engine-bot",
			branchRed: async () => false,
		}) as unknown as GitHub;
	const merging = (checked: string[]) => ({
		repository: "acme/app",
		number: 4,
		defaultBranch: "main",
		conditions: { only_paths: ["docs/**"] },
		untrusted: false,
		untrustedPush: false,
		maintainers: ["alice"],
		reviewed: { headRefOid: "abc" },
		labels: [],
		agentChanged: async () => false,
		factoryChecks: async () => {
			checked.push("checks");
			return 'the check "test" failed (npm test)';
		},
		remember: () => {},
	});

	it("does not run the factory's checks when a cheaper refusal already stands", async () => {
		for (const [over, reason] of [
			[{ isCrossRepository: true }, "the pull request comes from a fork"],
			[{ headRefOid: "def" }, "new commits arrived since the run started"],
			[
				{ files: [{ path: "src/app.ts" }] },
				"src/app.ts is outside only_paths (docs/**)",
			],
		] as const) {
			const checked: string[] = [];
			expect(await applyMerge(merging(checked), pullRequest(over))).toEqual({
				action: "merge_pull_request",
				summary: "not merged",
				status: "refused",
				reason,
			});
			expect(checked).toEqual([]);
		}
	});

	it("reads the default branch once the checks are done: it may turn red while they run", async () => {
		let red = false;
		const run = {
			...merging([]),
			factoryChecks: async () => {
				red = true; // a commit lands on main, and its CI fails, during the checks
				return undefined;
			},
		};
		const github = {
			...pullRequest({}),
			branchRed: async () => red,
		} as unknown as GitHub;
		expect(await applyMerge(run, github)).toMatchObject({
			status: "refused",
			reason: "the checks of the default branch are failing",
		});
	});

	it("runs them when nothing else refuses, and says which failed", async () => {
		const checked: string[] = [];
		expect(await applyMerge(merging(checked), pullRequest({}))).toEqual({
			action: "merge_pull_request",
			summary: "not merged",
			status: "refused",
			reason: 'the check "test" failed (npm test)',
		});
		expect(checked).toEqual(["checks"]);
	});
});

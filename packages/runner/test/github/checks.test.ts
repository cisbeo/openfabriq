import { expect, it } from "vitest";
import {
	checksState,
	failedChecks,
	jobId,
	logExcerpt,
} from "../../src/github/checks.js";

const run = (name: string, status: string, conclusion: string) => ({
	__typename: "CheckRun",
	name,
	status,
	conclusion,
	detailsUrl: `https://github.com/o/r/actions/runs/1/job/${name.length}`,
});

it("reports failures only once every check has finished", () => {
	const failed = run("test", "COMPLETED", "FAILURE");
	expect(failedChecks([failed, run("lint", "IN_PROGRESS", "")])).toEqual([]);
	expect(
		failedChecks([
			failed,
			run("lint", "COMPLETED", "SUCCESS"),
			run("old", "COMPLETED", "CANCELLED"),
			{
				__typename: "StatusContext",
				context: "deploy",
				state: "ERROR",
				targetUrl: "https://ci.example/1",
			},
		]),
	).toEqual([
		{
			name: "test",
			conclusion: "FAILURE",
			url: "https://github.com/o/r/actions/runs/1/job/4",
		},
		{ name: "deploy", conclusion: "ERROR", url: "https://ci.example/1" },
	]);
	expect(
		failedChecks([
			{ __typename: "StatusContext", context: "deploy", state: "PENDING" },
			failed,
		]),
	).toEqual([]);
	expect(failedChecks([run("lint", "COMPLETED", "SUCCESS")])).toEqual([]);
	expect(failedChecks(undefined)).toEqual([]);
});

it("counts a commit status still expected or pending as running", () => {
	const passed = run("lint", "COMPLETED", "SUCCESS");
	for (const state of ["PENDING", "EXPECTED"]) {
		const status = { __typename: "StatusContext", context: "deploy", state };
		expect(checksState([passed, status])).toBe("pending");
	}
	expect(
		checksState([
			passed,
			{ __typename: "StatusContext", context: "deploy", state: "SUCCESS" },
		]),
	).toBe("passed");
	// A check run is running until it is COMPLETED, whatever its conclusion says.
	expect(checksState([run("lint", "QUEUED", "FAILURE")])).toBe("pending");
});

it("finds the GitHub Actions job behind a check", () => {
	expect(
		jobId("https://github.com/o/r/actions/runs/41349033172/job/124974989620"),
	).toBe("124974989620");
	expect(jobId("https://ci.example/1")).toBeUndefined();
});

it("keeps the log up to the last error, not the runner's cleanup", () => {
	const log = [
		...Array.from({ length: 150 }, (_, i) => `step ${i}`),
		"##[error]app/layout.tsx(20,50): error TS2304",
		"##[error]Process completed with exit code 2.",
		"Cleaning up orphan processes",
	].join("\n");
	const excerpt = logExcerpt(log).split("\n");
	expect(excerpt).toHaveLength(100);
	expect(excerpt.at(-1)).toBe("##[error]Process completed with exit code 2.");
	expect(logExcerpt("a\nb")).toBe("a\nb");
});

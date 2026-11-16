import { expect, it, vi } from "vitest";

// What gh answers to the API, by path; every call is kept.
let answers: { status: unknown; runs: unknown };
const asked: string[][] = [];
vi.mock("../../src/exec.js", () => ({
	exec: async (_command: string, args: string[]) => {
		asked.push(args);
		const path = args[1] ?? "";
		return JSON.stringify(
			path.includes("/check-runs") ? answers.runs : answers.status,
		);
	},
}));
const { gh, isRed } = await import("../../src/github/gh.js");

function red(state: string, conclusions: (string | null)[]) {
	answers = {
		status: { state },
		runs: { check_runs: conclusions.map((conclusion) => ({ conclusion })) },
	};
	return gh.branchRed("acme/app", "release/1");
}

it("tells a red commit from its status and its check runs", () => {
	const runs = (...conclusions: (string | null)[]) =>
		conclusions.map((conclusion) => ({ conclusion }));
	expect(isRed({ state: "pending" }, [])).toBe(false);
	expect(isRed({ state: "success" }, runs("success", null, "cancelled"))).toBe(
		false,
	);
	expect(isRed({ state: "error" }, runs("success"))).toBe(true);
	expect(isRed({ state: "success" }, runs("success", "timed_out"))).toBe(true);
});

it("calls a branch red when a status or a check run of its head failed", async () => {
	// With no status at all, GitHub says pending.
	expect(await red("pending", [])).toBe(false);
	expect(
		await red("success", ["success", null, "cancelled", "skipped", "neutral"]),
	).toBe(false);
	expect(await red("failure", [])).toBe(true);
	expect(await red("error", [])).toBe(true);
	for (const failed of ["failure", "timed_out", "startup_failure"])
		expect(await red("success", ["success", failed])).toBe(true);
	expect(asked.slice(0, 2)).toEqual([
		["api", "repos/acme/app/commits/release%2F1/status"],
		["api", "repos/acme/app/commits/release%2F1/check-runs?per_page=100"],
	]);
});

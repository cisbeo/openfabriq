import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Each gh call is kept with the time it started; `refusals` makes the next calls fail.
const calls: { args: string[]; at: number }[] = [];
let refusals: string[] = [];
vi.mock("../../src/exec.js", () => ({
	exec: async (_command: string, args: string[]) => {
		calls.push({ args, at: Date.now() });
		const refusal = refusals.shift();
		if (refusal) throw new Error(`gh ${args.join(" ")}: ${refusal}`);
		return JSON.stringify({ html_url: "https://github.com/acme/app/pull/1" });
	},
}));
let gh: typeof import("../../src/github/gh.js").gh;

const SECONDARY =
	"gh: You have exceeded a secondary rate limit and have been temporarily blocked from content creation. Please retry your request again later. (HTTP 403)";

beforeEach(async () => {
	vi.useFakeTimers();
	// The write queue lives in the module: a fresh one per test.
	vi.resetModules();
	({ gh } = await import("../../src/github/gh.js"));
	calls.length = 0;
	refusals = [];
});
afterEach(() => vi.useRealTimers());

const startedAt = () => calls.map((c) => c.at - (calls[0]?.at ?? 0));

it("leaves a second between two writes, even from two runs at once", async () => {
	const both = Promise.all([
		gh.comment("acme/app", 1, "first"),
		gh.addLabels("acme/app", 2, ["bug"]),
	]);
	await vi.advanceTimersByTimeAsync(2000);
	await both;
	expect(startedAt()).toEqual([0, 1000]);
});

it("does not hold reads back", async () => {
	await gh.comment("acme/app", 1, "a write");
	await gh.defaultBranch("acme/app");
	await gh.commitAuthor("acme/app", "abc");
	expect(startedAt()).toEqual([0, 0, 0]);
});

it("waits a minute after a rate limit refusal, then writes again", async () => {
	refusals = [SECONDARY];
	const url = gh.createPullRequest("acme/app", {
		title: "t",
		body: "b",
		head: "openfabriq/1-r1",
		base: "main",
	});
	await vi.advanceTimersByTimeAsync(60_000);
	expect(await url).toBe("https://github.com/acme/app/pull/1");
	expect(startedAt()).toEqual([0, 60_000]);
});

it("waits for a 429 and for gh pr merge too", async () => {
	refusals = ["GraphQL: API rate limit exceeded for user ID 1. (HTTP 429)"];
	const merged = gh.merge("acme/app", 3, {
		sha: "abc",
		method: "squash",
		auto: false,
	});
	await vi.advanceTimersByTimeAsync(60_000);
	await merged;
	expect(calls.map((c) => c.args[1])).toEqual(["merge", "merge"]);
});

it("gives up after four refusals, saying it was GitHub's rate limit", async () => {
	refusals = [SECONDARY, SECONDARY, SECONDARY, SECONDARY];
	const comment = gh.comment("acme/app", 1, "body");
	const failed = expect(comment).rejects.toThrow(
		/GitHub's rate limit: refused 4 times over 7 minutes.*secondary rate limit/,
	);
	await vi.advanceTimersByTimeAsync(60_000 + 120_000 + 240_000);
	await failed;
	expect(startedAt()).toEqual([0, 60_000, 180_000, 420_000]);
});

it("fails at once on any other error, and the next write still goes out", async () => {
	refusals = ["gh: Validation Failed (HTTP 422)"];
	await expect(
		gh.createIssue("acme/app", { title: "t", body: "b" }),
	).rejects.toThrow(/HTTP 422/);
	const next = gh.comment("acme/app", 1, "next");
	await vi.advanceTimersByTimeAsync(1000);
	await next;
	expect(calls).toHaveLength(2);
});

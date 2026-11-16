import { exec } from "@openfabriq/runner";
import { expect, it, vi } from "vitest";
import { githubSubjectState } from "../../src/subjects/github.js";

vi.mock("@openfabriq/runner", async (original) => ({
	...(await original<typeof import("@openfabriq/runner")>()),
	exec: vi.fn(),
}));

const PR = "https://github.com/acme/task-app/pull/7";

it("asks gh about an issue with gh issue, about a pull request with gh pr", async () => {
	const run = vi.mocked(exec);
	run.mockResolvedValueOnce('{"state":"CLOSED","labels":[]}');
	expect(
		await githubSubjectState("https://github.com/acme/app/issues/4"),
	).toEqual({ merged: false, open: false, needsHuman: false });
	run.mockResolvedValueOnce(
		'{"state":"MERGED","labels":[{"name":"Needs-Human"}]}',
	);
	expect(await githubSubjectState(PR)).toEqual({
		merged: true,
		open: false,
		needsHuman: true,
	});
	expect(run.mock.calls.map((c) => c[1]?.[0])).toEqual(["issue", "pr"]);
	run.mockRejectedValueOnce(new Error("gh: not found"));
	expect(await githubSubjectState(PR)).toBeUndefined();
});

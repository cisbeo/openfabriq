import type { Automation } from "@openfabriq/core";
import { expect, it } from "vitest";
import { needsCommitTool } from "../../src/run/launch.js";

const can = (...actions: string[]) =>
	({ can: actions.map((action) => ({ action })) }) as unknown as Pick<
		Automation,
		"can"
	>;

it("gives the commit tool to an agent that edits without a shell, when its automation publishes code", () => {
	expect(
		needsCommitTool(
			["read", "edit", "commands", "web"],
			can("create_pull_request"),
		),
	).toBe(true);
	expect(
		needsCommitTool(["read", "edit", "commands"], can("push_to_pull_request")),
	).toBe(true);
	// A shell commits with git; an agent that edits nothing has nothing to commit.
	expect(
		needsCommitTool(["read", "edit", "shell"], can("create_pull_request")),
	).toBe(false);
	expect(
		needsCommitTool(["read", "commands"], can("create_pull_request")),
	).toBe(false);
	// No code leaves the run: no commit to make.
	expect(needsCommitTool(["read", "edit"], can("add_comment"))).toBe(false);
});

it("tells an agent without a shell to commit with the commit tool", async () => {
	const { buildPrompt } = await import("../../src/run/prompt.js");
	const prompt = (commitTool: boolean) =>
		buildPrompt({
			automation: {
				instructions: "Update the dependencies.",
				can: [{ action: "create_pull_request" }],
			} as unknown as Automation,
			run: {
				id: "run-deps",
				repository: "acme/app",
				automation: "weekly-dependency-updates",
				repoWide: true,
				event: {
					key: "schedule",
					event: "schedule",
					isPullRequest: false,
					actor: "ada",
					at: "2026-11-09T06:00:00Z",
				},
			} as never,
			repository: "acme/app",
			ref: "main",
			actions: ["create_pull_request", "close_issue"],
			data: {},
			harness: { commands: {}, checks: [], agentCommands: false, commitTool },
		});
	expect(prompt(true)).toContain("commit first with the commit tool");
	expect(prompt(true)).not.toContain("commit with git first");
	expect(prompt(false)).toContain("commit with git first");
	// The other actions read the same, with or without the commit tool.
	for (const commitTool of [true, false])
		expect(prompt(commitTool)).toContain("close_issue: close this issue");
});

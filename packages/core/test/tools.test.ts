import { expect, it } from "vitest";
import { describeTool, isOutputTool } from "../src/tools.js";

it("names tool calls a person can read", () => {
	expect(describeTool("Bash", { command: "pnpm test\nmore" })).toEqual({
		title: "Run",
		detail: "pnpm test",
		output: false,
	});
	expect(
		describeTool("mcp__openfabriq__add_labels", { labels: ["a", "b"] }),
	).toEqual({ title: "Add labels", detail: "a, b", output: true });
	expect(describeTool("mcp__chat__list_runs", { project: "o/r" })).toEqual({
		title: "list_runs",
		detail: "o/r",
		output: false,
	});
	expect(
		describeTool("mcp__openfabriq__add_comment", { body: "## Review\n\nOK" }),
	).toEqual({ title: "Comment", detail: "Review", output: true });
	expect(describeTool("read_run", { id: "mvyf-9ca6" })).toEqual({
		title: "Read run",
		detail: "mvyf-9ca6",
		output: false,
	});
	expect(describeTool("TodoWrite", { todos: [] })).toEqual({
		title: "Update plan",
		output: false,
	});
});

it.each([
	["mcp__openfabriq__remove_labels", { labels: ["x"] }, "Remove labels", "x"],
	[
		"mcp__openfabriq__create_pull_request",
		{ title: "Fix" },
		"Open pull request",
		"Fix",
	],
	[
		"mcp__openfabriq__push_to_pull_request",
		{ summary: "More" },
		"Push to pull request",
		"More",
	],
	["mcp__openfabriq__request_changes", { body: "No" }, "Request changes", "No"],
	["mcp__openfabriq__create_issue", { title: "Bug" }, "Open issue", "Bug"],
	["mcp__openfabriq__close_issue", {}, "Close issue", undefined],
	["mcp__openfabriq__close_pr", {}, "Close pull request", undefined],
	["mcp__openfabriq__merge_pull_request", {}, "Merge pull request", undefined],
	["mcp__openfabriq__merge_pr", {}, "merge_pr", undefined],
	[
		"Read",
		{ file_path: "/tmp/of/worktrees/ab12/src/a.ts" },
		"Read",
		"src/a.ts",
	],
	["Edit", { file_path: "/home/me/repo/src/a.ts" }, "Edit", "src/a.ts"],
	["MultiEdit", { file_path: "a.ts" }, "Edit", "a.ts"],
	["Write", { file_path: "a.ts" }, "Write", "a.ts"],
	["NotebookEdit", { notebook_path: "n.ipynb" }, "Edit notebook", "n.ipynb"],
	["Grep", { pattern: "TODO" }, "Search", "TODO"],
	["Glob", { pattern: "*.ts" }, "Find files", "*.ts"],
	["Skill", { skill: "setup" }, "Load skill", "setup"],
	["WebFetch", { url: "https://a.dev" }, "Fetch", "https://a.dev"],
	["WebSearch", { query: "zod" }, "Search the web", "zod"],
	["Task", { description: "Look" }, "Delegate", "Look"],
	["Agent", { description: "Look" }, "Delegate", "Look"],
	["factory_overview", {}, "Read the factory", undefined],
	["Unknown", { n: 1 }, "Unknown", undefined],
] as const)("names %s", (name, input, title, detail) => {
	// A first text argument that is not the one to show: the detail comes from the right key.
	const args = detail === undefined ? input : { other: "not this", ...input };
	expect(describeTool(name, args)).toEqual(
		detail === undefined
			? { title, output: name.startsWith("mcp__openfabriq__") }
			: { title, detail, output: name.startsWith("mcp__openfabriq__") },
	);
});

it("shows the first line of a text, without heading marks, cut at 140 characters", () => {
	expect(describeTool("Bash", { description: "  ## Run tests\nmore" })).toEqual(
		{ title: "Run", detail: "Run tests", output: false },
	);
	const long = "x".repeat(141);
	expect(describeTool("Bash", { description: long }).detail).toBe(
		`${"x".repeat(139)}…`,
	);
	expect(describeTool("Bash", { description: "x".repeat(140) }).detail).toBe(
		"x".repeat(140),
	);
	// A heading mark needs a space: "#1" is a word.
	expect(describeTool("Bash", { description: "#1 issue" }).detail).toBe(
		"#1 issue",
	);
});

it("names a chat's run listing by what it lists, never as a failure", () => {
	expect(describeTool("list_runs", { status: "failed" })).toEqual({
		title: "List failed runs",
		output: false,
	});
	expect(describeTool("list_runs", { agent: "triage" })).toEqual({
		title: "List runs",
		detail: "of triage",
		output: false,
	});
});

it("names the engine's command tool as a command, not an output", () => {
	expect(
		describeTool("mcp__openfabriq__run_command", { name: "test" }),
	).toEqual({
		title: "Run command",
		detail: "test",
		output: false,
	});
	expect(isOutputTool("mcp__openfabriq__run_command")).toBe(false);
	expect(isOutputTool("mcp__openfabriq__merge_pull_request")).toBe(true);
});

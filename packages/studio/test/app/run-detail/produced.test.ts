import { HANDOFF_SUMMARY } from "@openfabriq/core";
import { expect, it } from "vitest";
import {
	delta,
	diffLines,
	filesCount,
	openAtFirst,
	outputsCount,
	produced,
	replacedProposals,
} from "../../../app/src/features/run-detail/produced.js";
import type { ToolCall } from "../../../app/src/features/run-detail/run-log.js";
import { detail } from "./detail.js";

const call = (
	id: string,
	toolName: string,
	args: Record<string, unknown>,
	more: Partial<ToolCall> = {},
): ToolCall => ({
	type: "tool-call",
	toolCallId: id,
	toolName,
	args,
	artifact: {
		title: toolName,
		...(typeof args.file_path === "string" ? { detail: args.file_path } : {}),
		output: toolName.startsWith("mcp__openfabriq__"),
	},
	...more,
});

it("leaves out of Written what a proposal already shows, and keeps the engine's handoff", () => {
	const { run } = detail({
		outputs: [
			{ action: "add_labels", summary: "ready-for-agent", status: "applied" },
			{ action: "add_comment", summary: HANDOFF_SUMMARY, status: "applied" },
		],
	});
	const p = produced(run, [
		call("p1", "mcp__openfabriq__add_labels", { labels: ["ready-for-agent"] }),
	]);
	expect(p.proposals.map((c) => c.toolCallId)).toEqual(["p1"]);
	expect(p.written).toEqual([run.outputs[1]]);
	expect(outputsCount(p)).toBe(2);
	expect(filesCount(p)).toBe(0);
});

it("matches a merge to its result by its action, and leaves the command tool out of the outputs", () => {
	const { run } = detail({
		outputs: [
			{
				action: "merge_pull_request",
				summary: "auto-merge on (squash): GitHub merges when the checks pass",
				status: "applied",
			},
		],
	});
	const p = produced(run, [
		call("c1", "mcp__openfabriq__run_command", { name: "test" }),
		call("m1", "mcp__openfabriq__merge_pull_request", {}),
	]);
	expect(p.proposals.map((c) => c.toolCallId)).toEqual(["m1"]);
	expect(p.written).toEqual([]);
});

it("lists each changed file once, with its edits in order, and leaves failed edits out", () => {
	const edits = [
		call("e1", "Edit", {
			file_path: "a.ts",
			old_string: "x",
			new_string: "y\nz",
		}),
		call("e2", "Write", { file_path: "b.ts", content: "new" }),
		call("e3", "Edit", {
			file_path: "a.ts",
			old_string: "1\n2",
			new_string: "3",
		}),
		call(
			"e4",
			"Edit",
			{ file_path: "c.ts", old_string: "", new_string: "" },
			{
				isError: true,
			},
		),
		call("r1", "Read", { file_path: "d.ts" }),
	];
	const p = produced(detail().run, edits);
	expect(
		p.files.map((f) => [f.path, f.edits.map((e) => e.toolCallId)]),
	).toEqual([
		["a.ts", ["e1", "e3"]],
		["b.ts", ["e2"]],
	]);
	expect(delta(p.files[0]?.edits ?? [])).toEqual({ add: 3, del: 3 });
});

it("counts the lines of a MultiEdit's edits", () => {
	expect(
		delta([
			call("m", "MultiEdit", {
				file_path: "a.ts",
				edits: [
					{ old_string: "a", new_string: "b\nc" },
					{ old_string: "d\ne", new_string: "f" },
				],
			}),
		]),
	).toEqual({ add: 3, del: 3 });
});

it("lists Git's files once the run recorded them, each with its counts and the agent's edits on it", () => {
	const p = produced(
		detail().run,
		[
			call("e1", "Edit", {
				file_path: "/w/run-1/src/a.ts",
				old_string: "x",
				new_string: "y",
			}),
			// Reverted or ignored by Git: not a change of the run.
			call("e2", "Write", { file_path: "/w/run-1/tmp.log", content: "x" }),
			// Under docs/README.md, never under README.md as well.
			call("e3", "Write", {
				file_path: "/w/run-1/docs/README.md",
				content: "d",
			}),
			call("e4", "Write", { file_path: "/w/run-1/README.md", content: "r" }),
		],
		{
			total: 5,
			files: [
				{ path: "src/a.ts", add: 4, del: 1 },
				// Written by the shell: no edit, still listed.
				{ path: "evidence/shot.png" },
				{ path: "README.md", add: 1, del: 0 },
				{ path: "docs/README.md", add: 1, del: 0 },
			],
		},
	);
	expect(p.fromGit).toBe(true);
	expect(
		p.files.map((f) => [
			f.path,
			f.add,
			f.del,
			f.edits.map((e) => e.toolCallId),
		]),
	).toEqual([
		["src/a.ts", 4, 1, ["e1"]],
		["evidence/shot.png", undefined, undefined, []],
		["README.md", 1, 0, ["e4"]],
		["docs/README.md", 1, 0, ["e3"]],
	]);
	// Git counted one more than the run kept.
	expect(p.more).toBe(1);
	expect(filesCount(p)).toBe(5);
	expect(outputsCount(p)).toBe(0);
});

it("counts the edits' lines while no Git list is recorded: a run still running, or an older one", () => {
	const p = produced(detail().run, [
		call("e1", "Edit", {
			file_path: "a.ts",
			old_string: "x",
			new_string: "y\nz",
		}),
	]);
	expect(p.fromGit).toBe(false);
	expect(p.files).toEqual([
		expect.objectContaining({ path: "a.ts", add: 2, del: 1 }),
	]);
});

it("counts the lines a recorded diff shows, none without one", () => {
	const hunk = (n: number) => ({
		header: "@@ -1 +1 @@",
		lines: Array.from({ length: n }, (_, i) => ({
			type: " " as const,
			text: "",
			old: i + 1,
			new: i + 1,
		})),
	});
	expect(diffLines({ path: "a.ts", hunks: [hunk(2), hunk(3)] })).toBe(5);
	expect(diffLines({ path: "shot.png", noPatch: "binary" })).toBe(0);
});

it("starts with every file folded, but the only file of a run when it is short", () => {
	const file = (path: string, n: number) => ({
		path,
		hunks: [
			{
				header: "@@ -1 +1 @@",
				lines: Array.from({ length: n }, (_, i) => ({
					type: "+" as const,
					text: "",
					new: i + 1,
				})),
			},
		],
	});
	const files = [
		file("long.ts", 300),
		...Array.from({ length: 8 }, (_, i) => file(`f${i}.ts`, 299)),
		file("small.ts", 5),
		{ path: "shot.png", noPatch: "binary" as const },
	];
	// Several files: all folded, the list of paths and counts reads first.
	expect([...openAtFirst(files)]).toEqual([]);
	// One file of a readable size opens; a long one stays folded.
	expect([...openAtFirst([file("small.ts", 5)])]).toEqual(["small.ts"]);
	expect([...openAtFirst([file("long.ts", 300)])]).toEqual([]);
});

it("shows the pull request a reviewed run proposed last, not each version it proposed before a review sent it back", () => {
	const { run } = detail({
		outputs: [
			{
				action: "create_pull_request",
				summary: "Add a counter",
				status: "applied",
			},
		],
	});
	const calls = [
		call("p1", "mcp__openfabriq__create_pull_request", {
			title: "Add a counter",
			body: "v1",
		}),
		call("p2", "mcp__openfabriq__create_pull_request", {
			title: "Add a counter",
			body: "v2",
		}),
	];
	expect(
		produced(run, calls, undefined, true).proposals.map((c) => c.toolCallId),
	).toEqual(["p2"]);
	expect([...replacedProposals(calls, true)]).toEqual(["p1"]);
	// Without a review the engine keeps the first: both stay, as they were.
	expect(produced(run, calls).proposals.map((c) => c.toolCallId)).toEqual([
		"p1",
		"p2",
	]);
});

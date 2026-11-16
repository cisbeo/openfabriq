import { expect, it } from "vitest";
import { parseHunks, patchOf, withPatches } from "../../src/workspace/diff.js";

it("keeps a file's diff from its first hunk, without git's header lines", () => {
	expect(
		patchOf(
			"diff --git a/a.ts b/a.ts\nindex 1..2 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n",
		),
	).toBe("@@ -1 +1 @@\n-a\n+b\n");
	// An empty file added, or a mode changed: no line to show.
	expect(
		patchOf("diff --git a/e b/e\nnew file mode 100644\nindex 0..e69de\n"),
	).toBe("");
	expect(patchOf("")).toBe("");
});

it("numbers each line before and after the run, from its hunk's header", () => {
	const hunks = parseHunks(
		[
			"@@ -3,4 +3,5 @@ function a() {",
			" one",
			"-two",
			"+deux",
			"+trois",
			" ",
			" four",
			"@@ -20 +21,0 @@",
			"-gone",
			"\\ No newline at end of file",
			"",
		].join("\n"),
	);
	expect(hunks).toEqual([
		{
			header: "@@ -3,4 +3,5 @@ function a() {",
			lines: [
				{ type: " ", text: "one", old: 3, new: 3 },
				{ type: "-", text: "two", old: 4 },
				{ type: "+", text: "deux", new: 4 },
				{ type: "+", text: "trois", new: 5 },
				{ type: " ", text: "", old: 5, new: 6 },
				{ type: " ", text: "four", old: 6, new: 7 },
			],
		},
		{
			header: "@@ -20 +21,0 @@",
			lines: [{ type: "-", text: "gone", old: 20 }],
		},
	]);
	expect(parseHunks("")).toEqual([]);
});

it("numbers a new file's lines from 1", () => {
	expect(parseHunks("@@ -0,0 +1,2 @@\n+a\n+b\n")[0]?.lines).toEqual([
		{ type: "+", text: "a", new: 1 },
		{ type: "+", text: "b", new: 2 },
	]);
});

it("reads each file's diff in order, and marks binary files and those past a limit", async () => {
	const diffs: Record<string, string> = {
		"a.ts": "@@ -1 +1 @@\n-a\n+b\n", // 18 characters
		"big.ts": "x".repeat(30),
		"b.ts": "@@ -1 +1 @@\n-c\n+d\n",
		"c.ts": "@@ -1 +1 @@\n-e\n+f\n",
	};
	const read: string[] = [];
	const files = await withPatches(
		[
			{ path: "a.ts", add: 1, del: 1 },
			{ path: "shot.png" },
			{ path: "big.ts", add: 1, del: 0 },
			{ path: "b.ts", add: 1, del: 1 },
			{ path: "c.ts", add: 1, del: 1 },
		],
		async (path) => {
			read.push(path);
			return diffs[path] ?? "";
		},
		{ file: 20, total: 40 },
	);
	expect(files).toEqual([
		{ path: "a.ts", add: 1, del: 1, patch: diffs["a.ts"] },
		{ path: "shot.png", noPatch: "binary" },
		{ path: "big.ts", add: 1, del: 0, noPatch: "too large" },
		{ path: "b.ts", add: 1, del: 1, patch: diffs["b.ts"] },
		// 36 of 40 used: c.ts would pass the total.
		{ path: "c.ts", add: 1, del: 1, noPatch: "too large" },
	]);
	// A binary file is never read.
	expect(read).toEqual(["a.ts", "big.ts", "b.ts", "c.ts"]);
});

it("stops reading once the total is spent, and marks a file whose diff failed as too large", async () => {
	const read: string[] = [];
	const files = await withPatches(
		[
			{ path: "a.ts", add: 1, del: 0 },
			{ path: "b.ts", add: 1, del: 0 },
			{ path: "c.ts", add: 1, del: 0 },
		],
		async (path) => {
			read.push(path);
			if (path === "a.ts") throw new Error("maxBuffer length exceeded");
			return "y".repeat(10);
		},
		{ file: 20, total: 10 },
	);
	expect(files.map((f) => f.noPatch ?? "patch")).toEqual([
		"too large",
		"patch",
		"too large",
	]);
	expect(read).toEqual(["a.ts", "b.ts"]);
});

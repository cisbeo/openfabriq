import type { ChangedFile } from "./workspace.js";

/** One line of a file's diff, numbered before and after the run: an added line has no old number, a removed one no new number. */
export interface DiffLine {
	type: " " | "+" | "-";
	text: string;
	old?: number;
	new?: number;
}

/** A hunk: its "@@ -a,b +c,d @@" header, then its lines. */
export interface Hunk {
	header: string;
	lines: DiffLine[];
}

/**
 * How much diff a run keeps, in characters: a file past `file` keeps only its counts, and once the
 * run's diffs reach `total` the next files do too. A generated folder or a large file cannot blow up
 * the run's folder, nor the page that shows it.
 */
export const PATCH_LIMITS = { file: 256 * 1024, total: 2 * 1024 * 1024 };

/** A file's `git diff` from its first hunk: the header lines before it (diff --git, index, ---, +++) show nothing more. */
export function patchOf(diff: string): string {
	if (diff.startsWith("@@")) return diff;
	const at = diff.indexOf("\n@@");
	return at === -1 ? "" : diff.slice(at + 1);
}

const HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** A file's patch as hunks of numbered lines. */
export function parseHunks(patch: string): Hunk[] {
	const hunks: Hunk[] = [];
	let old = 0;
	let now = 0;
	for (const line of patch.split("\n")) {
		const head = HEADER.exec(line);
		if (head) {
			old = Number(head[1]);
			now = Number(head[2]);
			hunks.push({ header: line, lines: [] });
			continue;
		}
		const type = line[0];
		const hunk = hunks.at(-1);
		// "\ No newline at end of file", and the patch's last newline.
		if (!hunk || (type !== " " && type !== "+" && type !== "-")) continue;
		const text = line.slice(1);
		hunk.lines.push(
			type === "+"
				? { type, text, new: now++ }
				: type === "-"
					? { type, text, old: old++ }
					: { type, text, old: old++, new: now++ },
		);
	}
	return hunks;
}

/**
 * The files with their patches, read one at a time in order while the total allows. A binary file
 * is never read; a file whose diff is past a limit, or failed (git's output past its buffer), keeps
 * only its counts.
 */
export async function withPatches(
	files: ChangedFile[],
	patch: (path: string) => Promise<string>,
	limits = PATCH_LIMITS,
): Promise<ChangedFile[]> {
	let used = 0;
	const out: ChangedFile[] = [];
	for (const file of files) {
		if (file.add === undefined) {
			out.push({ ...file, noPatch: "binary" });
			continue;
		}
		const text =
			used < limits.total
				? await patch(file.path).catch(() => undefined)
				: undefined;
		if (
			text === undefined ||
			text.length > limits.file ||
			used + text.length > limits.total
		) {
			out.push({ ...file, noPatch: "too large" });
			continue;
		}
		used += text.length;
		out.push({ ...file, patch: text });
	}
	return out;
}

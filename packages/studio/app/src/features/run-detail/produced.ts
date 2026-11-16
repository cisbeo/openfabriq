import {
	actionOf,
	isOutcomeOf,
	isOutput,
	summaryOf,
} from "../../components/assistant-ui/tool-parts.js";
import type { RunRecord, ShownFile, ShownFiles } from "../../lib/types.js";
import type { ToolCall } from "./run-log.js";

const EDITS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

export interface Produced {
	/** What the agent asked the engine to write. */
	proposals: ToolCall[];
	/** What the engine wrote that no proposal asked for: its handoff, or an older run's outputs. */
	written: RunRecord["outputs"];
	/** The files the agent changed in its worktree, each with its lines added and removed, its diff when Git recorded it, and its edits in order. */
	files: (ShownFile & { edits: ToolCall[] })[];
	/** Whether the files come from Git, recorded at the end of the run, or only from the agent's edit calls. */
	fromGit: boolean;
	/** Changed files Git counted beyond those listed. */
	more: number;
}

/** The Git path an edit's absolute path ends with, the longest: docs/README.md before README.md. */
function owner(editPath: string, paths: string[]): string | undefined {
	let best: string | undefined;
	for (const p of paths)
		if (
			(editPath === p || editPath.endsWith(`/${p}`)) &&
			p.length > (best?.length ?? -1)
		)
			best = p;
	return best;
}

/**
 * reviewed_by: the pull requests and pushes the agent proposed before a review sent its change
 * back. The engine applies the one proposed last; the earlier ones were replaced.
 */
export function replacedProposals(
	calls: ToolCall[],
	reviewed: boolean,
): Set<string> {
	if (!reviewed) return new Set();
	const code = calls.filter(
		(c) =>
			actionOf(c.toolName) === "create_pull_request" ||
			actionOf(c.toolName) === "push_to_pull_request",
	);
	return new Set(
		code
			.filter(
				(c) =>
					c !==
					code.findLast((o) => actionOf(o.toolName) === actionOf(c.toolName)),
			)
			.map((c) => c.toolCallId),
	);
}

/** `changed` is Git's list, recorded once the run ended: without it, a running or older run, the edit calls tell. */
export function produced(
	run: RunRecord,
	calls: ToolCall[],
	changed?: ShownFiles,
	/** reviewed_by: the engine applies the pull request or push proposed last, after the review. */
	reviewed = false,
): Produced {
	const replaced = replacedProposals(calls, reviewed);
	const proposals = calls.filter(
		(c) => isOutput(c.toolName) && !replaced.has(c.toolCallId),
	);
	const written = run.outputs.filter(
		(o) => !proposals.some((p) => isOutcomeOf(o, actionOf(p.toolName), p.args)),
	);
	const files = new Map<string, ToolCall[]>();
	for (const c of calls)
		if (EDITS.has(c.toolName) && !c.isError) {
			const path = summaryOf(c).detail ?? c.toolName;
			files.set(path, [...(files.get(path) ?? []), c]);
		}
	if (changed) {
		// Git's paths are relative to the worktree, the edit calls' absolute.
		const paths = changed.files.map((f) => f.path);
		const edits = new Map<string, ToolCall[]>();
		for (const [path, calls] of files) {
			const p = owner(path, paths);
			if (p) edits.set(p, [...(edits.get(p) ?? []), ...calls]);
		}
		return {
			proposals,
			written,
			files: changed.files.map((f) => ({
				...f,
				edits: edits.get(f.path) ?? [],
			})),
			fromGit: true,
			more: changed.total - changed.files.length,
		};
	}
	return {
		proposals,
		written,
		files: [...files].map(([path, edits]) => ({
			path,
			...delta(edits),
			edits,
		})),
		fromGit: false,
		more: 0,
	};
}

/** The Outputs tab's count: what the agent proposed and what was written on GitHub. */
export const outputsCount = (p: Produced) =>
	p.proposals.length + p.written.length;

/** How many lines a file's recorded diff shows, context included. */
export const diffLines = (f: ShownFile) =>
	f.hunks?.reduce((n, h) => n + h.lines.length, 0) ?? 0;

/**
 * The files whose diff starts open: none, so the tab reads first as the list of files and their
 * counts, but the only file of a run when its diff is under 300 lines.
 */
export function openAtFirst(files: ShownFile[]): Set<string> {
	const [only] = files;
	const n = files.length === 1 && only ? diffLines(only) : 0;
	return new Set(only && n > 0 && n < 300 ? [only.path] : []);
}

/** The Files changed tab's count, the files Git counted beyond the list included. */
export const filesCount = (p: Produced) => p.files.length + p.more;

const lines = (v: unknown) =>
	typeof v === "string" && v ? v.split("\n").length : 0;

/** "+12 −3", from the edits' text: what changed, not what the commit holds. */
export function delta(edits: ToolCall[]) {
	let add = 0;
	let del = 0;
	for (const e of edits) {
		add += lines(e.args.new_string ?? e.args.content ?? e.args.new_source);
		del += lines(e.args.old_string);
		if (Array.isArray(e.args.edits))
			for (const x of e.args.edits as Record<string, unknown>[]) {
				add += lines(x.new_string);
				del += lines(x.old_string);
			}
	}
	return { add, del };
}

import {
	FilePen,
	FileText,
	GitPullRequestArrow,
	MessageSquare,
	Search,
	SquareTerminal,
	Tag,
} from "lucide-react";

export type Entry =
	| { kind: "event"; at: number; text: string }
	| { kind: "message"; at: number; text: string }
	| { kind: "thinking"; at: number }
	| {
			kind: "tool";
			at: number;
			verb: string;
			arg: string;
			icon: typeof FileText;
			note?: string;
			bad?: boolean;
	  }
	| { kind: "proposed"; at: number; output: number }
	| {
			kind: "engine";
			at: number;
			text: string;
			output?: number;
			refused?: boolean;
	  };

// An example run of examples/00-at-a-glance: the implementer on a labeled issue. Illustrative.
export const LOG: Entry[] = [
	{
		kind: "event",
		at: 0,
		text: "Queued: an issue is labeled (ready-for-agent), on Issue #44.",
	},
	{
		kind: "event",
		at: 0,
		text: "Started implementer on sonnet.",
	},
	{ kind: "thinking", at: 3 },
	{
		kind: "message",
		at: 6,
		text: "I'll start with the export and the comment on #44.",
	},
	{
		kind: "tool",
		at: 9,
		verb: "Read",
		arg: "src/export/csv.ts",
		icon: FileText,
	},
	{ kind: "tool", at: 14, verb: "Search", arg: "findMany", icon: Search },
	{
		kind: "tool",
		at: 19,
		verb: "Read",
		arg: "src/db/tasks.ts",
		icon: FileText,
	},
	{
		kind: "message",
		at: 24,
		text: "The export loads every task at once. I'll write the test that shows it, then stream the rows.",
	},
	{
		kind: "tool",
		at: 30,
		verb: "Write",
		arg: "src/export/csv.test.ts",
		icon: FilePen,
	},
	{
		kind: "tool",
		at: 34,
		verb: "Run",
		arg: "pnpm test",
		icon: SquareTerminal,
		note: "1 failed",
		bad: true,
	},
	{
		kind: "tool",
		at: 41,
		verb: "Edit",
		arg: "src/export/csv.ts",
		icon: FilePen,
	},
	{
		kind: "tool",
		at: 47,
		verb: "Run",
		arg: "pnpm test",
		icon: SquareTerminal,
		note: "passed",
	},
	{
		kind: "message",
		at: 50,
		text: "The test failed before the change and passes now. Opening the pull request.",
	},
	{ kind: "proposed", at: 52, output: 0 },
	{ kind: "proposed", at: 52, output: 1 },
	{ kind: "proposed", at: 53, output: 2 },
	{ kind: "engine", at: 55, text: "Checks passed: test, lint" },
	{
		kind: "engine",
		at: 58,
		text: "Started reviewer, round 1 of the internal review: approved, risk low, $0.21.",
	},
	{
		kind: "engine",
		at: 61,
		text: "Wrote: Open a pull request “Stream the export instead of loading every task”, labeled ready-to-merge and risk:low",
		output: 0,
	},
	{
		kind: "engine",
		at: 61,
		text: "Wrote: Comment “What changed, and the test that proves it”",
		output: 1,
	},
	{
		kind: "engine",
		at: 61,
		text: "Did not write: Remove labels “bug” — not in can.remove_labels",
		output: 2,
		refused: true,
	},
];

export const OUTPUTS = [
	{
		icon: GitPullRequestArrow,
		action: "Open a pull request",
		detail: "Stream the export instead of loading every task",
	},
	{
		icon: MessageSquare,
		action: "Comment",
		detail: "On Issue #44: what changed, and the test that proves it",
	},
	{ icon: Tag, action: "Remove labels", detail: "bug" },
];

export const COST_PER_STEP = 0.068;
// The run is already under way when the page shows it, and plays again from there.
export const START = 5;

/** The run's clock: 65 → "1:05". */
export const clockOf = (s: number) =>
	`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export type OutputState = "proposed" | "applied" | "refused";

/** Where output `i` stands in a log: proposed by the agent, then applied or refused by the engine. */
export function outputState(log: Entry[], i: number): OutputState | null {
	const engine = log.find((e) => e.kind === "engine" && e.output === i);
	if (engine && engine.kind === "engine")
		return engine.refused ? "refused" : "applied";
	if (log.some((e) => e.kind === "proposed" && e.output === i))
		return "proposed";
	return null;
}

export type Source = "issue" | "sentry" | "webhook";

export interface Subject {
	source: Source;
	label: string;
	title: string;
	agent: "implementer" | "investigator";
	/** Where the run ends, and what it leaves on the card. */
	outcome:
		| { stage: "done"; wrote: "pr" | "issue"; cost: string }
		| { stage: "needs"; reason: string; cost: string };
}

// A week of a small factory (examples/00-at-a-glance). Illustrative: no real repository.
// The first six are on the board when it appears; the rest arrive, then the list goes round.
export const POOL: Subject[] = [
	{
		source: "issue",
		label: "Issue",
		title: "Typo on the pricing page",
		agent: "implementer",
		outcome: { stage: "done", wrote: "pr", cost: "$0.07" },
	},
	{
		source: "sentry",
		label: "Sentry",
		title: "TypeError: Cannot read properties of undefined (reading 'total')",
		agent: "implementer",
		outcome: { stage: "done", wrote: "pr", cost: "$0.62" },
	},
	{
		source: "issue",
		label: "Issue",
		title: "Login fails with SSO accounts",
		agent: "implementer",
		outcome: {
			stage: "needs",
			reason: "Handed to a human",
			cost: "$0.11",
		},
	},
	{
		source: "issue",
		label: "Issue",
		title: "Keyboard shortcut to add a task",
		agent: "implementer",
		outcome: { stage: "done", wrote: "pr", cost: "$0.41" },
	},
	{
		source: "webhook",
		label: "Deploy",
		title: "Deploy of 9c2e417 failed: the build cannot find @acme/ui",
		agent: "investigator",
		outcome: { stage: "done", wrote: "issue", cost: "$0.18" },
	},
	{
		source: "issue",
		label: "Issue",
		title: "Remember the last filter between visits",
		agent: "implementer",
		outcome: {
			stage: "needs",
			// The checks failed twice: the engine refused the code and handed the issue over.
			reason: "Handed to a human",
			cost: "$1.08",
		},
	},
	{
		source: "issue",
		label: "Issue",
		title: "Export fails for accounts with more than 1,000 tasks",
		agent: "implementer",
		outcome: { stage: "done", wrote: "pr", cost: "$1.36" },
	},
	{
		source: "sentry",
		label: "Sentry",
		title: "RangeError: Invalid time value in formatDueDate",
		agent: "implementer",
		outcome: { stage: "done", wrote: "pr", cost: "$0.34" },
	},
	{
		source: "issue",
		label: "Issue",
		title: "Show the trial's days left in the header",
		agent: "implementer",
		outcome: { stage: "done", wrote: "pr", cost: "$0.52" },
	},
	{
		source: "webhook",
		label: "Deploy",
		title: "Deploy of 4f81ac0 failed: migration 0042 timed out",
		agent: "investigator",
		outcome: { stage: "done", wrote: "issue", cost: "$0.23" },
	},
	{
		source: "issue",
		label: "Issue",
		title: "Dark mode for the settings page",
		agent: "implementer",
		outcome: {
			stage: "needs",
			reason: "Handed to a human",
			cost: "$0.15",
		},
	},
];

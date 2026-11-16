import type { RunRecord } from "@openfabriq/runner";
import type { RunDetail } from "../../../app/src/lib/types.js";

/**
 * A run of the implementer on issue #4, succeeded, with nothing else: each test adds what it
 * needs. A field given as undefined is left out.
 */
export function detail(
	run: { [K in keyof RunRecord]?: RunRecord[K] | undefined } = {},
	more: Partial<Omit<RunDetail, "run">> = {},
): RunDetail {
	const merged: Record<string, unknown> = {
		id: "r1",
		repository: "acme/shop",
		automation: "implement-ready-issues",
		agent: "implementer",
		event: "issue.labeled",
		label: "ready-for-agent",
		number: 4,
		isPullRequest: false,
		status: "succeeded",
		queuedAt: "2026-11-03T10:00:00.000Z",
		outputs: [],
		...run,
	};
	for (const key of Object.keys(merged))
		if (merged[key] === undefined) delete merged[key];
	return {
		run: merged as unknown as RunRecord,
		automationFile: `openfabriq/automations/${String(merged.automation)}/automation.md`,
		transcript: { messages: [] },
		story: { effects: [], followers: [] },
		commands: [],
		...more,
	};
}

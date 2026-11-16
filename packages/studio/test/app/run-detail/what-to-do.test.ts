import { HANDOFF_SUMMARY } from "@openfabriq/core";
import { describe, expect, it } from "vitest";
import {
	reportNote,
	rerunHint,
	runTab,
	type Words,
	whatToDo,
} from "../../../app/src/features/run-detail/what-to-do.js";
import type { RunRecord } from "../../../app/src/lib/types.js";
import type { RunStory } from "../../../src/runs/story.js";
import { detail } from "./detail.js";

/** Words as a reader sees them, code in backticks. */
const text = (w: Words) =>
	w
		.map((x) =>
			typeof x === "string" ? x : "code" in x ? `\`${x.code}\`` : x.strong,
		)
		.join("");

const handoff = {
	action: "add_comment" as const,
	summary: HANDOFF_SUMMARY,
	status: "applied" as const,
};
const failed = {
	attention: { kind: "failed" as const },
	effects: [],
	followers: [],
};

describe("a failed run", () => {
	it("says the engine labeled the issue it handed over, then how to start again", () => {
		const ask = whatToDo(
			detail(
				{ status: "failed", reason: "Claude Code exited", outputs: [handoff] },
				{ story: failed },
			),
		);
		expect(ask?.tone).toBe("bad");
		expect(ask?.error).toBe("Claude Code exited");
		expect(ask?.see).toBe("logs");
		expect(ask?.steps.map(text)).toEqual([
			"openfabriq commented on Issue #4 and labeled it `needs-human`: it waits for you there.",
			"Read the error: the agent did not start.",
			"Fix the cause, in the repository or in openfabriq/.",
			"To run it again, remove the label “ready-for-agent” from Issue #4 and add it back, or run `openfabriq run implement-ready-issues --issue 4` in a terminal.",
		]);
	});

	it("names no label when the subject has no number", () => {
		const ask = whatToDo(
			detail(
				{
					status: "failed",
					number: undefined,
					event: "slack.mentioned",
					label: undefined,
					source: { kind: "slack", label: "#factory" },
					outputs: [handoff],
				},
				{ story: failed },
			),
		);
		expect(text(ask?.steps[0] ?? [])).toBe(
			"openfabriq commented on #factory: it waits for you there.",
		);
		expect(ask?.error).toBe("The agent ended on an error.");
	});

	it("says which limit to raise when a limit stopped it", () => {
		const ask = whatToDo(
			detail(
				{ status: "failed", reason: "Cost limit reached (usd_per_run)" },
				{ story: failed },
			),
		);
		expect(ask?.steps.map(text)).toContain(
			"To allow more, raise `usd_per_run` in `openfabriq/factory.yaml`, then run `openfabriq apply`.",
		);
	});

	it("says a run stopped twice is not run a third time, with the engine's reason", () => {
		const ask = whatToDo(
			detail(
				{ status: "failed", reason: "interrupted: the engine stopped" },
				{ story: failed },
			),
		);
		expect(ask?.error).toBe("interrupted: the engine stopped");
		expect(text(ask?.steps[0] ?? [])).toContain(
			"openfabriq does not run it a third time",
		);
	});

	it("points to the command the error names, and to the agent's steps when it started", () => {
		const ask = whatToDo(
			detail(
				{
					status: "failed",
					reason: 'No Linear key: run "openfabriq connect linear".',
				},
				{
					story: failed,
					transcript: {
						messages: [{ id: "m", role: "assistant", content: [] }],
					},
				},
			),
		);
		expect(ask?.steps.slice(0, 2).map(text)).toEqual([
			"Read the error, and the agent's last steps in Logs.",
			"Run the command the error names, in a terminal on this machine.",
		]);
	});
});

it("hands a pull request over after its review rounds, with the limit to raise", () => {
	const ask = whatToDo(
		detail(
			{
				status: "failed",
				isPullRequest: true,
				number: 7,
				reason: "review_rounds reached (3)",
			},
			{
				story: {
					attention: { kind: "handed-over", by: "engine" },
					effects: [],
					followers: [],
				},
			},
		),
	);
	expect(ask?.tone).toBe("warn");
	expect(ask?.title).toBe("Your turn: openfabriq handed PR #7 to you");
	expect(text(ask?.body ?? [])).toBe(
		"It stopped because the pull request used all its review rounds without passing review.",
	);
	// The engine writes "review_rounds reached (3)": no limit in parentheses, no step to raise it.
	expect(ask?.steps.map(text)).toEqual([
		"Read openfabriq's comment and the last review on PR #7.",
		"Finish the change yourself, or close it.",
	]);
});

it("sends a person to the pull request its internal review left to them", () => {
	const ask = whatToDo(
		detail(
			{
				status: "succeeded",
				reason:
					"the internal review asks for a person: reviewer gave no verdict",
			},
			{
				story: {
					attention: { kind: "handed-over", by: "engine" },
					effects: [],
					followers: [],
				},
			},
		),
	);
	expect(ask?.title).toBe(
		"Your turn: the internal review left the pull request to you",
	);
	expect(text(ask?.body ?? [])).toMatch(
		/'s pull request is open with needs-human: reviewer gave no verdict\.$/,
	);
	expect(ask?.steps.map(text)).toEqual([
		"Read the Internal review section of the pull request, and the rounds below.",
		"Finish the change yourself, or close it.",
	]);
});

it("adds the limit to raise when the engine names it in parentheses", () => {
	const ask = whatToDo(
		detail(
			{ status: "failed", reason: "stopped after 45 min (minutes_per_run)" },
			{
				story: {
					attention: { kind: "handed-over", by: "engine" },
					effects: [],
					followers: [],
				},
			},
		),
	);
	expect(text(ask?.body ?? [])).toBe(
		"It stopped because stopped after 45 min (minutes_per_run).",
	);
	expect(text(ask?.steps.at(-1) ?? [])).toBe(
		"To allow more, raise `minutes_per_run` in `openfabriq/factory.yaml`, then run `openfabriq apply`.",
	);
});

it("asks for a review when the agent hands a pull request to a person", () => {
	const ask = whatToDo(
		detail(
			{ isPullRequest: true, number: 7 },
			{
				story: {
					attention: { kind: "handed-over", by: "agent" },
					effects: [],
					followers: [],
				},
			},
		),
	);
	expect(ask?.tone).toBe("accent");
	expect(ask?.steps.map(text)).toEqual([
		"Review PR #7 on GitHub.",
		"Merge it, or comment to ask for changes.",
	]);
});

it("says the day's budget is spent, and how to start again", () => {
	const ask = whatToDo(
		detail(
			{ status: "skipped" },
			{
				story: {
					attention: { kind: "cost-limit" },
					effects: [],
					followers: [],
				},
			},
		),
	);
	expect(ask?.title).toBe("Skipped: the factory's budget for today is spent");
	expect(text(ask?.steps[0] ?? [])).toBe(
		"Wait for tomorrow, or raise `usd_per_day` in `openfabriq/factory.yaml` and run `openfabriq apply`.",
	);
	expect(ask?.steps).toHaveLength(2);
});

describe("outputs not written", () => {
	const notApplied = (count: number) => ({
		attention: { kind: "not-applied" as const, count },
		effects: [],
		followers: [],
	});

	it("names a Slack run's output after where it was to be written, without GitHub", () => {
		const failed = {
			action: "add_comment",
			summary: "Done",
			status: "failed",
			reason: "Slack refused it",
		} as const;
		const ask = whatToDo(
			detail(
				{
					event: "slack.mentioned",
					number: undefined,
					label: undefined,
					source: { kind: "slack", label: "#factory" },
					outputs: [failed],
				},
				{ story: notApplied(1) },
			),
		);
		expect(ask?.title).toBe("1 output was not written");
		expect(ask?.steps.map(text)).toEqual([
			"Slack reply: Slack refused it.",
			"If it matters, write it yourself.",
		]);
		// A webhook has nowhere to answer: what it writes is on GitHub.
		const webhook = whatToDo(
			detail(
				{
					event: "webhook.received",
					source: { kind: "webhook", label: "deploys" },
					outputs: [failed],
				},
				{ story: notApplied(1) },
			),
		);
		expect(webhook?.title).toBe("1 output was not written on GitHub");
	});

	it("tells to allow a refused output in the automation's can", () => {
		const ask = whatToDo(
			detail(
				{
					outputs: [
						{
							action: "add_labels",
							summary: "deploy",
							status: "refused",
							reason: "not allowed",
						},
						{ action: "add_comment", summary: "Done", status: "applied" },
					],
				},
				{ story: notApplied(1) },
			),
		);
		expect(ask?.title).toBe("1 output was not written on GitHub");
		expect(ask?.see).toBe("outputs");
		expect(ask?.steps.map(text)).toEqual([
			"Add labels: not allowed.",
			"If the factory should allow it, add it to `can` in `openfabriq/automations/implement-ready-issues/automation.md`, then run `openfabriq apply`.",
		]);
	});

	it("leaves a merge its conditions refused to a person, without calling it a failure", () => {
		const ask = whatToDo(
			detail(
				{
					outputs: [
						{
							action: "add_labels",
							summary: "ready-to-merge, risk:low",
							status: "applied",
						},
						{
							action: "merge_pull_request",
							summary: "not merged",
							status: "refused",
							reason: "src/greeting.js is outside paths (docs/**)",
						},
					],
				},
				{ story: notApplied(1) },
			),
		);
		expect(ask?.title).toBe("Left for you to merge");
		expect(ask?.tone).toBe("warn");
		expect(ask?.steps.map(text)).toEqual([
			"Why: src/greeting.js is outside paths (docs/**).",
			"Merge it on GitHub when it is right. To let such pull requests merge alone, widen the conditions of `merge_pull_request` in `openfabriq/automations/implement-ready-issues/automation.md`, then run `openfabriq apply`.",
		]);
	});

	it("tells to write a failed output by hand", () => {
		const ask = whatToDo(
			detail(
				{
					outputs: [
						{ action: "add_comment", summary: "Done", status: "failed" },
						{ action: "create_issue", summary: "Bug", status: "failed" },
					],
				},
				{ story: notApplied(2) },
			),
		);
		expect(ask?.title).toBe("2 outputs were not written on GitHub");
		expect(ask?.steps.map(text)).toEqual([
			"Comment: failed.",
			"Open an issue: failed.",
			"If it matters, write it on GitHub yourself.",
		]);
	});
});

it("says the agent wrote nothing, and how to start again", () => {
	const ask = whatToDo(
		detail(
			{ reason: "the agent proposed no output" },
			{
				story: {
					attention: { kind: "no-output" },
					effects: [],
					followers: [],
				},
			},
		),
	);
	expect(ask?.tone).toBe("warn");
	expect(ask?.title).toBe("implementer wrote nothing");
	expect(text(ask?.body ?? [])).toBe(
		"The run ended without proposing any output, so nothing changed on Issue #4. Its report below says why.",
	);
	expect(text(ask?.steps[1] ?? [])).toContain(
		"remove the label “ready-for-agent”",
	);
});

it("asks nothing of a run that needs no one", () => {
	expect(whatToDo(detail())).toBeUndefined();
});

describe("how a run starts again", () => {
	it("at the next event, for Slack", () => {
		const { run } = detail({
			event: "slack.mentioned",
			label: undefined,
			source: { kind: "slack", label: "#factory" },
		});
		expect(text(rerunHint(run))).toBe(
			"It runs again at the next matching event: someone mentions the factory in Slack.",
		);
	});

	it("by labeling the pull request again, or manually", () => {
		const { run } = detail({
			event: "pull_request.labeled",
			label: "review",
			isPullRequest: true,
			number: 7,
		});
		expect(text(rerunHint(run))).toBe(
			"To run it again, remove the label “review” from PR #7 and add it back, or run `openfabriq run implement-ready-issues --pr 7` in a terminal.",
		);
	});

	it("at its next time, for a schedule", () => {
		const { run } = detail({
			event: "schedule",
			label: undefined,
			number: undefined,
		});
		expect(text(rerunHint(run))).toBe(
			"It runs again at its next scheduled time, or now with `openfabriq run implement-ready-issues`.",
		);
	});

	it("at the next matching event otherwise", () => {
		const { run } = detail({ event: "pull_request.opened", label: undefined });
		expect(text(rerunHint(run))).toBe(
			"It runs again at the next matching event (a pull request is opened), or now with `openfabriq run implement-ready-issues --issue 4`.",
		);
	});
});

describe("the tab a run opens on", () => {
	it("is the one asked for, Outputs only when there are some", () => {
		expect(runTab("logs", "succeeded", { outputs: 0, files: 0 })).toBe("logs");
		expect(runTab("outputs", "succeeded", { outputs: 2, files: 0 })).toBe(
			"outputs",
		);
		expect(runTab("outputs", "succeeded", { outputs: 0, files: 0 })).toBe(
			"summary",
		);
		expect(runTab("summary", "running", { outputs: 0, files: 0 })).toBe(
			"summary",
		);
	});

	it("is Files changed only when the run changed some", () => {
		expect(runTab("files", "succeeded", { outputs: 0, files: 3 })).toBe(
			"files",
		);
		expect(runTab("files", "succeeded", { outputs: 2, files: 0 })).toBe(
			"summary",
		);
	});

	it("is the log of a running run, else the summary", () => {
		expect(runTab(undefined, "running", { outputs: 0, files: 0 })).toBe("logs");
		expect(runTab(undefined, "queued", { outputs: 0, files: 0 })).toBe(
			"summary",
		);
		expect(runTab("nonsense", "failed", { outputs: 1, files: 0 })).toBe(
			"summary",
		);
	});
});

describe("a run whose issue or pull request is over on GitHub", () => {
	const handedOver = {
		attention: { kind: "handed-over" as const, by: "agent" as const },
		effects: [],
		followers: [],
	};

	it("says nothing is left to do once the pull request is merged, not “Your turn”", () => {
		const ask = whatToDo(
			detail(
				{ number: 23, isPullRequest: true },
				{
					story: handedOver,
					subjectState: { merged: true, open: false },
				},
			),
		);
		expect(ask?.tone).toBe("accent");
		expect(ask?.title).toBe("Nothing left to do: PR #23 was merged on GitHub");
		expect(ask?.steps).toEqual([]);
	});

	it("keeps the error of a failed run whose issue was closed", () => {
		const ask = whatToDo(
			detail(
				{ status: "failed", reason: "Claude Code exited" },
				{ story: failed, subjectState: { merged: false, open: false } },
			),
		);
		expect(ask?.title).toBe(
			"Nothing left to do: Issue #4 was closed on GitHub",
		);
		expect(ask?.error).toBe("Claude Code exited");
	});

	it("names Linear or Sentry when the issue is over there", () => {
		const over = { merged: false, open: false };
		const linear = whatToDo(
			detail(
				{
					status: "failed",
					number: undefined,
					source: { kind: "linear", label: "ENG-12" },
				},
				{ story: failed, subjectState: over },
			),
		);
		expect(linear?.title).toBe(
			"Nothing left to do: ENG-12 is done or canceled in Linear",
		);
		const sentry = whatToDo(
			detail(
				{
					status: "failed",
					number: undefined,
					source: { kind: "sentry", label: "WEB-12" },
				},
				{ story: failed, subjectState: over },
			),
		);
		expect(sentry?.title).toBe(
			"Nothing left to do: WEB-12 is resolved or ignored in Sentry",
		);
	});

	it("still asks while it is open", () => {
		const ask = whatToDo(
			detail(
				{ number: 23, isPullRequest: true },
				{ story: handedOver, subjectState: { merged: false, open: true } },
			),
		);
		expect(ask?.title).toMatch(/^Ready for you/);
	});

	it("asks nothing once someone took needs-human off, as the board moves it to Done", () => {
		expect(
			whatToDo(
				detail(
					{ number: 23, isPullRequest: true },
					{
						story: handedOver,
						subjectState: { merged: false, open: true, needsHuman: false },
					},
				),
			),
		).toBeUndefined();
	});
});

describe("a run the engine stopped", () => {
	const stopped = {
		status: "failed" as const,
		reason: "interrupted: the engine stopped",
	};

	it("says it ran again, and asks nothing", () => {
		const ask = whatToDo(
			detail(stopped, {
				story: {
					attention: { kind: "interrupted" },
					rerun: { id: "r2", agent: "implementer", status: "succeeded" },
					effects: [],
					followers: [],
				},
			}),
		);
		expect(ask?.tone).toBe("accent");
		expect(ask?.title).toBe("Interrupted: openfabriq ran it again");
		expect(text(ask?.body ?? [])).toBe(
			"The engine stopped during this run, so openfabriq queued it again once: implementer, succeeded. Nothing to do here.",
		);
		expect(ask?.steps).toEqual([]);
	});

	it("says a second interruption is not run again, without a cause to fix", () => {
		const ask = whatToDo(detail(stopped, { story: failed }));
		expect(ask?.title).toBe("This run failed");
		expect(ask?.steps.map(text)).toEqual([
			"The engine stopped during this run, and it was already run again once after a stop: openfabriq does not run it a third time.",
			"To run it again, remove the label “ready-for-agent” from Issue #4 and add it back, or run `openfabriq run implement-ready-issues --issue 4` in a terminal.",
		]);
	});
});

describe("the whole ask", () => {
	const story = (attention: NonNullable<RunStory["attention"]>) => ({
		attention,
		effects: [],
		followers: [],
	});

	it("points a failed run whose issue was closed to its logs, with a default error", () => {
		expect(
			whatToDo(
				detail(
					{ status: "failed" },
					{
						story: story({ kind: "failed" }),
						subjectState: { merged: false, open: false },
					},
				),
			),
		).toEqual({
			tone: "accent",
			title: "Nothing left to do: Issue #4 was closed on GitHub",
			error: "The agent ended on an error.",
			see: "logs",
			steps: [],
		});
	});

	it("says the agents could not finish when the engine gives no reason", () => {
		expect(
			whatToDo(
				detail(
					{ status: "failed" },
					{ story: story({ kind: "handed-over", by: "engine" }) },
				),
			),
		).toEqual({
			tone: "warn",
			title: "Your turn: openfabriq handed Issue #4 to you",
			body: ["It stopped because the agents could not finish."],
			steps: [
				["Read openfabriq's comment and the last review on Issue #4."],
				["Finish the change yourself, or close it."],
			],
		});
	});

	it("asks to answer the agent's comment on an issue it handed to a person", () => {
		expect(
			whatToDo(
				detail({}, { story: story({ kind: "handed-over", by: "agent" }) }),
			),
		).toEqual({
			tone: "accent",
			title: "Ready for you: implementer handed Issue #4 to a person",
			body: ["Its report is below."],
			steps: [
				["Read implementer's comment on Issue #4."],
				["Answer it, or label the issue for the next agent."],
			],
		});
	});

	it("says a run skipped for the budget cost nothing", () => {
		const ask = whatToDo(
			detail({ status: "skipped" }, { story: story({ kind: "cost-limit" }) }),
		);
		expect(ask?.tone).toBe("warn");
		expect(ask?.body).toEqual([
			"openfabriq did not start implementer. It cost nothing.",
		]);
		expect(ask?.steps[1]).toEqual(rerunHint(detail().run));
	});

	it("says a merge was refused when the engine gives no reason", () => {
		const ask = whatToDo(
			detail(
				{
					outputs: [
						{
							action: "merge_pull_request",
							summary: "not merged",
							status: "refused",
						},
					],
				},
				{ story: story({ kind: "not-applied", count: 1 }) },
			),
		);
		expect(ask?.see).toBe("outputs");
		expect(ask?.body).toEqual([
			"The agent asked to merge it; the factory's conditions keep it for a person.",
		]);
		expect(text(ask?.steps[0] ?? [])).toBe("Why: refused.");
	});

	it("labels an output by its action when it has no words", () => {
		const ask = whatToDo(
			detail(
				{
					outputs: [
						{
							action: "unknown_action" as "add_comment",
							summary: "x",
							status: "failed",
							reason: "boom",
						},
					],
				},
				{ story: story({ kind: "not-applied", count: 1 }) },
			),
		);
		expect(ask?.body).toEqual([
			"The agent proposed them; openfabriq did not write them.",
		]);
		expect(text(ask?.steps[0] ?? [])).toBe("unknown_action: boom.");
	});
});

describe("where the agent's report goes, while there is none", () => {
	const note = (status: RunRecord["status"], hasMessages: boolean) =>
		reportNote(detail({ status }).run, hasMessages);

	it("says the run waits or works, even before its first step", () => {
		expect(note("queued", false)).toBe(
			"The run waits for its turn. The agent's report appears here when it is done.",
		);
		expect(note("running", false)).toBe(
			"The agent is working. Follow it in Logs; its report appears here when it is done.",
		);
	});

	it("says the agent wrote none once it took steps", () => {
		expect(note("failed", true)).toBe(
			"The agent stopped before it wrote a report. Its last steps are in Logs.",
		);
		expect(note("succeeded", true)).toBe("The agent left no report.");
	});

	it("says nothing of a run that never started or was skipped", () => {
		expect(note("failed", false)).toBeUndefined();
		expect(note("succeeded", false)).toBeUndefined();
		expect(note("skipped", true)).toBeUndefined();
	});
});

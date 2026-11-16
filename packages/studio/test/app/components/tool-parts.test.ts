import { describe, expect, it } from "vitest";
import {
	outcomeSummary,
	outputBody,
	runIds,
	stepsLine,
	summaryOf,
} from "../../../app/src/components/assistant-ui/tool-parts.js";

it("finds the summary the runner records for each proposed output", () => {
	expect(outcomeSummary("add_labels", { labels: ["a", "b"] })).toBe("a, b");
	expect(outcomeSummary("create_pull_request", { title: "Counter" })).toBe(
		"Counter",
	);
	expect(outcomeSummary("push_to_pull_request", { summary: "Fix" })).toBe(
		"Fix",
	);
	expect(
		outcomeSummary("add_comment", { body: `${"x".repeat(130)}\nmore` }),
	).toBe("x".repeat(120));
});

it("links the runs a chat tool read, at most twelve", () => {
	const part = (toolName: string, args: object, result?: unknown) => ({
		toolCallId: "t",
		toolName,
		args: args as Record<string, unknown>,
		result,
	});
	expect(runIds(part("read_run", { id: "r1" }, "not json"))).toEqual(["r1"]);
	expect(
		runIds(part("list_runs", {}, JSON.stringify([{ id: "a" }, { id: "b" }]))),
	).toEqual(["a", "b"]);
	expect(runIds(part("list_runs", {}, { runs: [{ id: "c" }, {}] }))).toEqual([
		"c",
	]);
	const many = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}` }));
	expect(runIds(part("list_runs", {}, many))).toHaveLength(12);
});

it("names a call by its own name when it carries no summary", () => {
	expect(
		summaryOf({
			toolCallId: "t",
			toolName: "mcp__openfabriq__add_comment",
			args: {},
		}),
	).toEqual({ title: "mcp__openfabriq__add_comment", output: true });
});

describe("what a proposal's card shows", () => {
	const proposal = (action: string, args: Record<string, unknown>) => ({
		toolName: `mcp__openfabriq__${action}`,
		args,
	});

	it("shows its title or summary, its labels and its body", () => {
		expect(
			outputBody(
				proposal("create_pull_request", { title: "Counter", body: "Adds it" }),
				undefined,
			),
		).toEqual({
			heading: "Counter",
			labels: undefined,
			body: "Adds it",
			result: undefined,
			refusal: undefined,
			empty: false,
		});
		expect(
			outputBody(
				proposal("push_to_pull_request", { summary: "Fix" }),
				undefined,
			).heading,
		).toBe("Fix");
		expect(
			outputBody(proposal("add_labels", { labels: ["bug", 3] }), undefined)
				.labels,
		).toEqual(["bug", "3"]);
	});

	it("shows the labels a removal really took off, and says when there was nothing to remove", () => {
		const remove = proposal("remove_labels", {
			labels: ["needs-human", "risk:low", "risk:high"],
		});
		const summary = "needs-human, risk:low, risk:high";
		expect(
			outputBody(remove, { status: "applied", summary, removed: ["risk:low"] }),
		).toMatchObject({ labels: ["risk:low"], result: undefined });
		expect(
			outputBody(remove, { status: "applied", summary, removed: [] }),
		).toMatchObject({
			labels: undefined,
			result: "Nothing to remove.",
			empty: false,
		});
		// A run from before the engine said it: the proposed labels, as before.
		expect(
			outputBody(remove, { status: "applied", summary }).labels,
		).toHaveLength(3);
	});

	it("shows what the engine did of a merge, and why an output was refused", () => {
		const merge = proposal("merge_pull_request", {});
		expect(outputBody(merge, undefined).empty).toBe(true);
		expect(
			outputBody(merge, { status: "applied", summary: "Merged as abc123" })
				.result,
		).toBe("Merged as abc123");
		expect(
			outputBody(merge, {
				status: "refused",
				summary: "not merged",
				reason: "checks are red",
			}),
		).toMatchObject({
			result: undefined,
			refusal: "checks are red",
			empty: false,
		});
		expect(
			outputBody(proposal("close_issue", {}), {
				status: "applied",
				summary: "closed",
				reason: "kept",
			}).empty,
		).toBe(true);
	});
});

it("folds a block of steps into its first four titles and a count of the rest", () => {
	const call = (title: string, detail?: string) => ({
		toolCallId: title,
		toolName: "Bash",
		args: {},
		artifact: { title, ...(detail ? { detail } : {}), output: false },
	});
	expect(stepsLine([call("Read", "a.ts"), call("Run", "ls")])).toBe(
		"Read a.ts · Run ls",
	);
	expect(stepsLine(["A", "B", "C", "D", "E", "F"].map((t) => call(t)))).toBe(
		"A · B · C · D · +2",
	);
	expect(stepsLine([])).toBe("");
});

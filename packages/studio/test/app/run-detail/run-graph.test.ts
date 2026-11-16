import { HANDOFF_LABEL } from "@openfabriq/core";
import { UserRound } from "lucide-react";
import { expect, it } from "vitest";
import {
	runBoxes,
	runFlow,
} from "../../../app/src/features/run-detail/run-graph.js";
import { eventIcon } from "../../../app/src/lib/icons.js";
import { detail } from "./detail.js";

const ids = (d: ReturnType<typeof runBoxes>) => d.boxes.map((b) => b.id);

it("starts from the run before, when one caused this one", () => {
	const graph = runBoxes(
		detail(
			{},
			{
				story: {
					cause: {
						id: "r0",
						agent: "triage",
						automation: "triage-issues",
						status: "succeeded",
						output: 0,
					},
					effects: [],
					followers: [],
				},
			},
		),
		3,
	);
	expect(ids(graph)).toEqual(["cause", "trigger", "run"]);
	expect(graph.boxes[0]).toMatchObject({
		title: "triage",
		detail: "succeeded · the run before",
		href: "#/run/r0?project=acme%2Fshop",
	});
	expect(graph.links).toEqual([
		["cause", "trigger", false],
		["trigger", "run", false],
	]);
	expect(graph.boxes[2]?.detail).toBe("succeeded · 3 steps · —");
});

it("draws the runs an output started, and the dashed ones only where none ran", () => {
	const graph = runBoxes(
		detail(
			{
				outputs: [
					{
						action: "add_labels",
						summary: "ready-for-agent",
						status: "applied",
					},
					{
						action: "create_pull_request",
						summary: "Counter",
						status: "applied",
					},
				],
			},
			{
				story: {
					effects: [
						{
							id: "r2",
							agent: "implementer",
							automation: "implement-ready-issues",
							status: "running",
							output: 0,
						},
					],
					followers: [
						[{ automation: "implement-ready-issues", agent: "implementer" }],
						[{ automation: "review-pull-requests", agent: "reviewer" }],
					],
				},
			},
		),
		0,
	);
	expect(ids(graph)).toEqual([
		"trigger",
		"run",
		"out0",
		"run-r2",
		"out1",
		"next-1-review-pull-requests",
	]);
	expect(graph.links).toContainEqual(["out0", "run-r2", false]);
	expect(graph.links).toContainEqual([
		"out1",
		"next-1-review-pull-requests",
		true,
	]);
});

it("draws You once, from the first output that hands work to a person", () => {
	const graph = runBoxes(
		detail(
			{
				outputs: [
					{ action: "add_labels", summary: "deploy", status: "refused" },
					{
						action: "add_labels",
						summary: `needs-info, ${HANDOFF_LABEL}`,
						status: "applied",
					},
				],
			},
			{
				story: {
					attention: { kind: "not-applied", count: 1 },
					effects: [],
					followers: [],
				},
			},
		),
		1,
	);
	expect(ids(graph).filter((id) => id === "you")).toHaveLength(1);
	expect(graph.links).toContainEqual(["out0", "you", true]);
	expect(graph.boxes.find((b) => b.id === "you")?.detail).toBe(
		"not written on GitHub · see above",
	);
});

it("tells a person to merge what the factory's conditions left to them", () => {
	const graph = runBoxes(
		detail(
			{
				outputs: [
					{
						action: "merge_pull_request",
						summary: "not merged",
						status: "refused",
						reason: "src/a.ts is outside paths (docs/**)",
					},
				],
			},
			{
				story: {
					attention: { kind: "not-applied", count: 1 },
					effects: [],
					followers: [],
				},
			},
		),
		1,
	);
	expect(graph.boxes.find((b) => b.id === "you")?.detail).toBe(
		"merge it yourself · see above",
	);
});

it("leads to You from the run itself when a person must act and no output says so", () => {
	const graph = runBoxes(
		detail(
			{ status: "failed", reason: "boom" },
			{
				story: { attention: { kind: "failed" }, effects: [], followers: [] },
			},
		),
		0,
	);
	expect(graph.boxes.find((b) => b.id === "run")?.detail).toBe("did not start");
	expect(graph.links.at(-1)).toEqual(["run", "you", true]);
});

it("shows that openfabriq, not the agent, wrote what follows a run that never started", () => {
	const graph = runBoxes(
		detail(
			{
				status: "failed",
				reason: 'setup "npm ci" exited with code 254',
				outputs: [
					{
						action: "add_comment",
						status: "applied",
						summary: "The run failed",
					},
					{
						action: "add_labels",
						status: "applied",
						summary: "needs-human",
					},
				],
			},
			{
				story: { attention: { kind: "failed" }, effects: [], followers: [] },
			},
		),
		0,
	);
	expect(graph.boxes.find((b) => b.id === "run")?.detail).toBe(
		"did not start · setup failed",
	);
	expect(graph.links).toContainEqual(["run", "engine", false]);
	expect(graph.links).toContainEqual(["engine", "out0", false]);
	expect(graph.links).toContainEqual(["engine", "out1", false]);
	expect(graph.links).toContainEqual(["out1", "you", true]);
});

it("draws a run the engine stopped as interrupted, then the run queued again, and no You", () => {
	const graph = runBoxes(
		detail(
			{
				status: "failed",
				reason: "interrupted: the engine stopped",
				durationMs: 15_000,
			},
			{
				story: {
					attention: { kind: "interrupted" },
					rerun: { id: "r2", agent: "implementer", status: "succeeded" },
					effects: [],
					followers: [],
				},
			},
		),
		0,
	);
	expect(graph.boxes.find((b) => b.id === "run")?.detail).toBe(
		"interrupted · 15s",
	);
	expect(graph.boxes.find((b) => b.id === "rerun")).toMatchObject({
		title: "implementer",
		detail: "succeeded · ran again",
	});
	expect(graph.links).toContainEqual(["run", "rerun", false]);
	expect(graph.boxes.some((b) => b.id === "you")).toBe(false);
});

it("names a manual run and who asked for it as what started the run", () => {
	const graph = runBoxes(
		detail({
			event: "schedule",
			number: undefined,
			label: undefined,
			manual: "Ada",
		}),
		0,
	);
	expect(graph.boxes.find((b) => b.id === "trigger")).toMatchObject({
		title: "Manual run",
		detail: "Ada",
	});
});

it("says where the run stands in its box", () => {
	const work = (run: Parameters<typeof detail>[0], steps: number) =>
		runBoxes(detail(run), steps).boxes.find((b) => b.id === "run")?.detail;
	expect(work({ status: "running" }, 0)).toBe("working");
	expect(work({ status: "running" }, 1)).toBe("working · 1 step");
	expect(work({ status: "queued" }, 0)).toBe("waiting for its turn");
	expect(work({ status: "skipped" }, 0)).toBe("skipped before it started");
	expect(
		work({ status: "failed", reason: "setup failed: npm ci exited 1" }, 0),
	).toBe("did not start · setup failed");
	expect(work({ status: "failed", durationMs: 90_000 }, 4)).toBe(
		"failed · 4 steps · 1m 30s",
	);
});

it("draws the event that started the run, linked to its issue", () => {
	const graph = runBoxes(
		detail({ url: "https://github.com/acme/shop/issues/4" }),
		0,
	);
	expect(graph.boxes.find((b) => b.id === "trigger")).toEqual({
		id: "trigger",
		tone: "ok",
		event: true,
		icon: eventIcon("issue.labeled"),
		title: "Issue labeled",
		detail: "Issue #4 · ready-for-agent",
		href: "https://github.com/acme/shop/issues/4",
		external: true,
	});
});

it("leads to You from an output that was not written", () => {
	const graph = runBoxes(
		detail(
			{
				url: "https://github.com/acme/shop/issues/4",
				outputs: [{ action: "add_comment", summary: "Done", status: "failed" }],
			},
			{
				story: {
					attention: { kind: "not-applied", count: 1 },
					effects: [],
					followers: [],
				},
			},
		),
		2,
	);
	expect(graph.boxes.find((b) => b.id === "you")).toEqual({
		id: "you",
		tone: "you",
		icon: UserRound,
		title: "You",
		detail: "not written on GitHub · see above",
		href: "https://github.com/acme/shop/issues/4",
		external: true,
	});
	expect(graph.links.at(-1)).toEqual(["out0", "you", true]);
});

it("lets a box with a link take the click: React Flow leaves the others to the pane", () => {
	const flow = runFlow(
		detail({
			outputs: [
				{
					action: "create_pull_request",
					summary: "Show the due date",
					status: "applied",
					url: "https://github.com/acme/shop/pull/9",
				},
				{ action: "add_labels", summary: "bug", status: "applied" },
			],
		}),
		3,
		"LR",
	);
	const style = (id: string) =>
		flow.nodes.find((n) => n.id === id)?.style?.pointerEvents;
	expect(style("out0")).toBe("all");
	expect(style("out1")).toBeUndefined();
	expect(style("run")).toBeUndefined();
});

it("puts the reviewer between the agent and what it wrote, with its rounds and verdict", () => {
	const reviews = [
		{
			round: 1,
			reviewer: "reviewer",
			verdict: "needs_changes" as const,
			summary: "Off by one.",
			findings: [],
			costUsd: 0.05,
			at: "2026-11-03T10:01:00.000Z",
		},
		{
			round: 2,
			reviewer: "reviewer",
			verdict: "approved" as const,
			risk: "low" as const,
			summary: "Fixed.",
			findings: [],
			costUsd: 0.05,
			at: "2026-11-03T10:02:00.000Z",
		},
	];
	const graph = runBoxes(
		detail(
			{
				outputs: [
					{
						action: "create_pull_request",
						summary: "Add a counter",
						status: "applied",
						url: "https://github.com/acme/shop/pull/9",
					},
				],
			},
			{ reviews },
		),
		3,
	);
	expect(graph.boxes.find((b) => b.id === "review")).toMatchObject({
		title: "reviewer",
		detail: "approved, risk low · 2 rounds",
		tone: "ok",
	});
	expect(graph.links).toEqual(
		expect.arrayContaining([
			["run", "review", false],
			["review", "out0", false],
		]),
	);
});

it("names a Slack run's comment after where it is written, a GitHub run's as a comment", () => {
	const outputs = [
		{ action: "add_comment", summary: "Here is the plan", status: "failed" },
	] as const;
	const notApplied = {
		story: {
			attention: { kind: "not-applied" as const, count: 1 },
			effects: [],
			followers: [],
		},
	};
	const slack = runBoxes(
		detail(
			{
				event: "slack.mentioned",
				source: { kind: "slack", label: "#factory" },
				outputs: [...outputs],
			},
			notApplied,
		),
		2,
	);
	expect(slack.boxes.find((b) => b.id === "out0")?.title).toBe("Slack reply");
	expect(slack.boxes.find((b) => b.id === "you")?.detail).toBe(
		"not written · see above",
	);
	const github = runBoxes(detail({ outputs: [...outputs] }), 2);
	expect(github.boxes.find((b) => b.id === "out0")?.title).toBe("Comment");
});

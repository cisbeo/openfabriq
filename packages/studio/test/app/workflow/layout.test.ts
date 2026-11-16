import { join } from "node:path";
import { loadFactory, workflowGraph } from "@openfabriq/core";
import { readFactoryFolder } from "@openfabriq/runner";
import { expect, it } from "vitest";
import {
	arrows,
	flowElements,
	frameFit,
	loopLabel,
	neighbours,
	place,
} from "../../../app/src/features/workflow/layout.js";
import { personLoops } from "../../../app/src/features/workflow/person-loops.js";

const { factory } = loadFactory(
	readFactoryFolder(
		join(import.meta.dirname, "../../../../../fixtures/valid/sdlc/openfabriq"),
	),
);
if (!factory) throw new Error("02-sdlc does not load");
const graph = workflowGraph(factory);
const loops = personLoops(graph);

it("draws the factory's arrows and the loops through a person", () => {
	const all = arrows(graph, loops);
	expect(all).toHaveLength(graph.edges.length + loops.length);
	expect(all.at(-1)).toEqual({
		id: loops.at(-1)?.id,
		source: loops.at(-1)?.source,
		target: loops.at(-1)?.target,
	});
	expect(loopLabel({ ...loops[0], who: "a maintainer" } as never)).toBe(
		"a maintainer answers",
	);
});

it("places every box top to bottom, with a path for each arrow and loop", () => {
	const placed = place(graph, loops);
	expect([...placed.positions.keys()].sort()).toEqual(
		graph.nodes.map((n) => n.id).sort(),
	);
	for (const e of arrows(graph, loops))
		expect(placed.paths.get(e.id)).toMatch(/^M/);
	expect([...placed.middles.keys()]).toEqual(loops.map((l) => l.id));
	// Work starts at the top: an entry event sits above the automation it starts.
	const first = graph.edges.find(
		(e) => graph.nodes.find((n) => n.id === e.source)?.entry,
	);
	expect(first).toBeDefined();
	const y = (id: string) => placed.positions.get(id)?.y ?? Number.NaN;
	expect(y(first?.source ?? "")).toBeLessThan(y(first?.target ?? ""));
	// The loops take lanes outside every box.
	const boxes = [...placed.positions.values()];
	const left = Math.min(...boxes.map((p) => p.x));
	const right = Math.max(...boxes.map((p) => p.x + p.width));
	for (const m of placed.middles.values())
		expect(m.x < left || m.x > right).toBe(true);
});

it("takes each loop round the side nearer to its boxes, in lanes as wide as its words", () => {
	const { factory: sdlc } = loadFactory(
		readFactoryFolder(
			join(import.meta.dirname, "../../../../../examples/02-sdlc/openfabriq"),
		),
	);
	if (!sdlc) throw new Error("02-sdlc does not load");
	const g = workflowGraph(sdlc);
	const ls = personLoops(g);
	expect(ls.length).toBeGreaterThan(1);
	const placed = place(g, ls);
	const boxes = [...placed.positions.values()];
	const left = Math.min(...boxes.map((p) => p.x));
	const right = Math.max(...boxes.map((p) => p.x + p.width));
	const centre = (id: string) => {
		const p = placed.positions.get(id);
		if (!p) throw new Error(`${id} is not placed`);
		return p.x + p.width / 2;
	};
	const sides = new Set<string>();
	for (const l of ls) {
		const at = placed.middles.get(l.id);
		if (!at) throw new Error(`${l.id} has no lane`);
		const rightSide =
			(centre(l.source) + centre(l.target)) / 2 > (left + right) / 2;
		sides.add(rightSide ? "right" : "left");
		if (rightSide) expect(at.x).toBeGreaterThan(right);
		else expect(at.x).toBeLessThan(left);
		// Inside the graph's frame, with room for its words.
		expect(at.x).toBeGreaterThanOrEqual(10);
		expect(at.x).toBeLessThanOrEqual(placed.width - 10);
	}
	// 02-sdlc has loops on both sides: none crosses the whole graph to reach the left.
	expect(sides).toEqual(new Set(["left", "right"]));
	// Two lanes on one side never put their words on top of each other.
	const xs = [...placed.middles.values()].map((m) => m.x).sort((a, b) => a - b);
	for (let i = 1; i < xs.length; i++)
		expect((xs[i] ?? 0) - (xs[i - 1] ?? 0)).toBeGreaterThanOrEqual(24);
});

it("draws every box where it was placed, and every arrow on its path", () => {
	const placed = place(graph, loops);
	const { nodes, edges } = flowElements(graph, loops, placed, undefined);
	const first = graph.nodes[0];
	const p = placed.positions.get(first?.id ?? "");
	expect(nodes[0]).toEqual({
		id: first?.id,
		type: first?.kind,
		position: { x: p?.x, y: p?.y },
		width: p?.width,
		height: p?.height,
		data: { node: first, dim: false, focus: false },
		draggable: false,
		selectable: false,
	});
	const edge = graph.edges[0];
	expect(edges[0]).toEqual({
		id: edge?.id,
		source: edge?.source,
		target: edge?.target,
		type: "routed",
		data: { d: placed.paths.get(edge?.id ?? "") },
		zIndex: 0,
		markerEnd: {
			type: "arrowclosed",
			width: 14,
			height: 14,
			color: "var(--line-2)",
		},
		style: {
			stroke: "var(--line-2)",
			strokeWidth: 1.25,
			opacity: 1,
			transition: "opacity 200ms, stroke 200ms",
		},
	});
	const loop = loops[0];
	expect(edges.find((e) => e.id === loop?.id)).toMatchObject({
		data: {
			label: loopLabel(loop as never),
			at: placed.middles.get(loop?.id ?? ""),
		},
		style: { strokeDasharray: "5 4" },
	});
});

it("lights the box in focus and its arrows, and fades the rest", () => {
	const placed = place(graph, loops);
	const focus = graph.edges[0]?.source ?? "";
	const { nodes, edges } = flowElements(graph, loops, placed, focus);
	const lit = neighbours(arrows(graph, loops), focus);
	for (const n of nodes) {
		expect(n.data.dim).toBe(!lit.has(n.id));
		expect(n.data.focus).toBe(n.id === focus);
	}
	for (const e of edges) {
		const on = e.source === focus || e.target === focus;
		expect(e.zIndex).toBe(on ? 1 : 0);
		expect(e.style).toMatchObject({
			stroke: on ? "var(--accent)" : "var(--line-2)",
			strokeWidth: on ? 1.75 : 1.25,
			opacity: on ? 1 : 0.25,
		});
		expect(e.markerEnd).toMatchObject({
			color: on ? "var(--accent)" : "var(--line-2)",
		});
	}
	expect(edges.some((e) => e.zIndex === 1)).toBe(true);
});

it("lights a box and those one arrow away, either way", () => {
	const edges = [
		{ source: "a", target: "b" },
		{ source: "b", target: "c" },
		{ source: "d", target: "b" },
		{ source: "c", target: "e" },
	];
	expect([...neighbours(edges, "b")].sort()).toEqual(["a", "b", "c", "d"]);
	expect([...neighbours(edges, "z")]).toEqual(["z"]);
});

it("puts the details beside the graph when both fit, else over it", () => {
	const beside = frameFit(1400, 600);
	expect(beside.side).toBe(true);
	expect(beside.frameWidth).toBe(1400 - 320 - 32);
	expect(beside.viewport).toEqual({
		x: (1048 - 600) / 2,
		y: 12,
		zoom: 1,
	});
	const over = frameFit(900, 2000);
	expect(over.side).toBe(false);
	// Never below 0.7: a wide factory starts from the left and scrolls.
	expect(over.viewport).toEqual({ x: 12, y: 12, zoom: 0.7 });
	expect(frameFit(0, 600).viewport.zoom).toBe(1);
});

it("puts a reviewer on the right of the automation it reviews, with two straight arrows between them", () => {
	const { factory: reviewed } = loadFactory(
		readFactoryFolder(
			join(import.meta.dirname, "../../../../../examples/02-sdlc/openfabriq"),
		),
	);
	if (!reviewed) throw new Error("02-sdlc does not load");
	const g = workflowGraph(reviewed);
	const placed = place(g, personLoops(g));
	const box = (id: string) => {
		const p = placed.positions.get(id);
		if (!p) throw new Error(`${id} is not placed`);
		return p;
	};
	const automation = box("automation:implement-ready-issues");
	const review = box("review:implement-ready-issues");
	expect(review.y).toBe(automation.y);
	expect(review.x).toBeGreaterThan(automation.x + automation.width);
	// Each arrow is one horizontal line: a move, then a line at the same height.
	for (const id of [
		"automation:implement-ready-issues→review:implement-ready-issues",
		"review:implement-ready-issues→automation:implement-ready-issues",
	])
		expect(placed.paths.get(id)).toMatch(
			/^M ?[\d.]+[ ,]([\d.]+) ?L ?[\d.]+[ ,]\1$/,
		);
	// Nothing else sits where the reviewer is.
	for (const [id, p] of placed.positions)
		if (id !== "review:implement-ready-issues")
			expect(
				p.y + p.height <= review.y ||
					p.y >= review.y + review.height ||
					p.x + p.width <= review.x ||
					p.x >= review.x + review.width,
			).toBe(true);
});

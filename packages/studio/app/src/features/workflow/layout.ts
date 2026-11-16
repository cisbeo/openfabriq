import { Graph, layout } from "@dagrejs/dagre";
import type { WorkflowGraph } from "@openfabriq/core";
import { type Edge, MarkerType } from "@xyflow/react";
import { type Point, rightAngles, roundedPath } from "./flow-path.js";
import type { FlowNode } from "./nodes.js";
import type { PersonLoop } from "./person-loops.js";

// Where the workflow's boxes and arrows go, top to bottom: where work starts, the
// automations in their order, where it reaches a person.

export const EVENT = { width: 192, height: 46 };
export const AUTOMATION = { width: 208, height: 60 };

/** The graph's arrows, and the loops through a person drawn as arrows too. */
export const arrows = (graph: WorkflowGraph, loops: PersonLoop[]) => [
	...graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
	...loops.map((l) => ({ id: l.id, source: l.source, target: l.target })),
];

export const loopLabel = (l: PersonLoop) => `${l.who} answers`;

/** Room beside the boxes for the loops through a person, one lane each: as wide as its words, turned upright. */
const LANE = 24;
/** Between an automation and its reviewer, on its right: room for two short arrows. */
const PAIR = 48;
/** How far above and below the middle of the boxes the change goes out and comes back. */
const PAIR_ARROWS = 10;

export function place(graph: WorkflowGraph, loops: PersonLoop[]) {
	const g = new Graph();
	g.setGraph({
		rankdir: "TB",
		nodesep: 16,
		edgesep: 12,
		ranksep: 44,
		marginx: 8,
		marginy: loops.length ? 30 : 20,
	});
	g.setDefaultEdgeLabel(() => ({}));
	// A reviewer sits on the right of the automation it reviews: dagre places the two as one wide box.
	const reviews = new Map(
		graph.nodes
			.filter((n) => n.kind === "review")
			.map((n) => [`automation:${n.title}`, n.id]),
	);
	const paired = new Set(reviews.values());
	for (const n of graph.nodes)
		if (!paired.has(n.id))
			g.setNode(n.id, {
				...(n.kind === "event"
					? EVENT
					: reviews.has(n.id)
						? { ...AUTOMATION, width: AUTOMATION.width * 2 + PAIR }
						: AUTOMATION),
			});
	// Only the factory's own arrows place the boxes: a loop through a person would turn the order upside down.
	for (const e of graph.edges)
		if (!paired.has(e.source) && !paired.has(e.target))
			g.setEdge(e.source, e.target);
	layout(g);
	const positions = new Map<
		string,
		{ x: number; y: number; width: number; height: number }
	>();
	for (const n of graph.nodes) {
		if (paired.has(n.id)) continue;
		const { x, y, width, height } = g.node(n.id);
		const left = x - width / 2;
		const top = y - height / 2;
		const review = reviews.get(n.id);
		if (!review) {
			positions.set(n.id, { x: left, y: top, width, height });
			continue;
		}
		positions.set(n.id, { ...AUTOMATION, x: left, y: top });
		positions.set(review, {
			...AUTOMATION,
			x: left + AUTOMATION.width + PAIR,
			y: top,
		});
	}
	// Each loop goes round the side nearer to its boxes, so none crosses the whole graph; the lanes
	// widen the graph on that side only.
	const centre = (id: string) => {
		const p = positions.get(id);
		return p ? p.x + p.width / 2 : 0;
	};
	const middle = (g.graph().width ?? 0) / 2;
	const onRight = loops.map(
		(l) => (centre(l.source) + centre(l.target)) / 2 > middle,
	);
	const room = (side: boolean) => {
		const n = onRight.filter((r) => r === side).length;
		return n ? LANE * n + LANE / 2 : 0;
	};
	const shift = room(false);
	for (const p of positions.values()) p.x += shift;
	/** A placed box by its middle, as dagre gives it. */
	const middleOf = (id: string) => {
		const p = positions.get(id) ?? { x: 0, y: 0, width: 0, height: 0 };
		return { ...p, x: p.x + p.width / 2, y: p.y + p.height / 2 };
	};
	// A long arrow passes through the empty places the layout keeps for it in each rank.
	const ranks = new Set(graph.nodes.map((n) => Math.round(middleOf(n.id).y)));
	const middles = new Map<string, Point>();
	const paths = new Map<string, string>();
	for (const e of graph.edges) {
		const s = middleOf(e.source);
		const t = middleOf(e.target);
		// Between an automation and its reviewer: one straight arrow each way, side by side.
		if (paired.has(e.source) || paired.has(e.target)) {
			const out = paired.has(e.target);
			const y = s.y + (out ? -PAIR_ARROWS : PAIR_ARROWS);
			const from = s.x + ((out ? 1 : -1) * s.width) / 2;
			const to = t.x + ((out ? -1 : 1) * t.width) / 2;
			paths.set(e.id, `M ${from} ${y} L ${to} ${y}`);
			continue;
		}
		// An arrow back up (a review loop) leaves from the top and comes in from below.
		const back = t.y < s.y;
		const start = { x: s.x, y: s.y + (back ? -s.height : s.height) / 2 };
		const end = { x: t.x, y: t.y + (back ? t.height : -t.height) / 2 };
		const lanes = (g.edge(e.source, e.target)?.points ?? [])
			.filter((p: { x: number; y: number }) => ranks.has(Math.round(p.y)))
			.map((p: { x: number; y: number }) => ({ x: p.x + shift, y: p.y }));
		paths.set(e.id, roundedPath(rightAngles([start, ...lanes, end]), 10));
	}
	// A loop leaves its box from below, climbs a lane along its side, and comes in from above.
	const boxes = [...positions.values()];
	const left = Math.min(...boxes.map((p) => p.x));
	const right = Math.max(...boxes.map((p) => p.x + p.width));
	const taken = { left: 0, right: 0 };
	loops.forEach((l, i) => {
		const s = middleOf(l.source);
		const t = middleOf(l.target);
		const lane = onRight[i]
			? right + LANE * ++taken.right
			: left - LANE * ++taken.left;
		const below = s.y + s.height / 2 + 14 + i * 4;
		const above = t.y - t.height / 2 - 14 - i * 4;
		const mid = (below + above) / 2;
		// The line stops where its words are written, so it never runs through them.
		const gap = Math.min((below - above) / 2, loopLabel(l).length * 3.4 + 14);
		paths.set(
			l.id,
			`${roundedPath(
				[
					{ x: s.x, y: s.y + s.height / 2 },
					{ x: s.x, y: below },
					{ x: lane, y: below },
					{ x: lane, y: mid + gap },
				],
				10,
			)} ${roundedPath(
				[
					{ x: lane, y: mid - gap },
					{ x: lane, y: above },
					{ x: t.x, y: above },
					{ x: t.x, y: t.y - t.height / 2 },
				],
				10,
			)}`,
		);
		middles.set(l.id, { x: lane, y: mid });
	});
	const box = g.graph();
	return {
		positions,
		paths,
		middles,
		width: (box.width ?? 0) + room(false) + room(true),
		height: box.height ?? 0,
	};
}

/**
 * The placed boxes and arrows as React Flow draws them: around the box in focus, the boxes one
 * arrow away stay lit and its arrows turn to the accent; the others fade. Without a focus, the
 * boxes `faded` names fade: seen from an area, the automations of elsewhere.
 */
export function flowElements(
	graph: WorkflowGraph,
	loops: PersonLoop[],
	placed: ReturnType<typeof place>,
	focus: string | undefined,
	faded: Set<string> = new Set(),
): { nodes: FlowNode[]; edges: Edge[] } {
	const all = arrows(graph, loops);
	const byLoop = new Map(loops.map((l) => [l.id, l]));
	const lit = focus ? neighbours(all, focus) : undefined;
	const nodes: FlowNode[] = graph.nodes.map((n) => {
		const p = placed.positions.get(n.id) ?? {
			x: 0,
			y: 0,
			width: 0,
			height: 0,
		};
		return {
			id: n.id,
			type: n.kind,
			position: { x: p.x, y: p.y },
			width: p.width,
			height: p.height,
			data: {
				node: n,
				dim: lit ? !lit.has(n.id) : faded.has(n.id),
				focus: n.id === focus,
				...(faded.has(n.id) ? { faded: true } : {}),
			},
			draggable: false,
			selectable: false,
		};
	});
	const edges: Edge[] = all.map((e) => {
		const on =
			focus !== undefined && (e.source === focus || e.target === focus);
		const color = on ? "var(--accent)" : "var(--line-2)";
		const loop = byLoop.get(e.id);
		const at = placed.middles.get(e.id);
		return {
			id: e.id,
			source: e.source,
			target: e.target,
			type: "routed",
			data: {
				d: placed.paths.get(e.id) ?? "",
				...(loop && at ? { label: loopLabel(loop), at } : {}),
			},
			zIndex: on ? 1 : 0,
			markerEnd: {
				type: MarkerType.ArrowClosed,
				width: 14,
				height: 14,
				color,
			},
			style: {
				stroke: color,
				strokeWidth: on ? 1.75 : 1.25,
				// Through a person, not the factory: dashed, as on the run's graph.
				...(loop ? { strokeDasharray: "5 4" } : {}),
				opacity: focus && !on ? 0.25 : 1,
				transition: "opacity 200ms, stroke 200ms",
			},
		};
	});
	return { nodes, edges };
}

/** The boxes linked to a box by one arrow, either way. */
export function neighbours(
	edges: { source: string; target: string }[],
	id: string,
): Set<string> {
	const out = new Set([id]);
	for (const e of edges) {
		if (e.source === id) out.add(e.target);
		if (e.target === id) out.add(e.source);
	}
	return out;
}

/** The width of the details panel, and its gap to the graph. */
export const PANEL = 320;
const GAP = 32;

/**
 * How the graph fits a frame `width` wide: the details beside it when both fit, at a zoom
 * where words stay readable, from the left when it is too wide to show whole.
 */
export function frameFit(width: number, graphWidth: number) {
	// The details sit beside the graph when both fit, the graph at 90% or more; else they float.
	const side = width > 0 && width - PANEL - GAP - 32 >= graphWidth * 0.9;
	const frameWidth = side ? width - PANEL - GAP : width;
	// Readable first: below 0.7 the words blur, so a wide factory scrolls sideways instead.
	const zoom =
		frameWidth > 0
			? Math.min(1, Math.max(0.7, (frameWidth - 32) / graphWidth))
			: 1;
	const wide = graphWidth * zoom > frameWidth - 16;
	// Too wide to show whole: start at the left, where the first boxes are.
	return {
		side,
		frameWidth,
		viewport: {
			x: wide ? 12 : (frameWidth - graphWidth * zoom) / 2,
			y: 12,
			zoom,
		},
	};
}

import {
	Controls,
	Handle,
	type Node,
	type NodeProps,
	Position,
	ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { useDark } from "../../hooks/use-theme.js";
import { useWidth } from "../../hooks/use-width.js";
import { MAC } from "../../lib/platform.js";
import type { RunDetail } from "../../lib/types.js";
import { type Box, H, runFlow, type Tone, W } from "./run-graph.js";

const TONE: Record<Tone, { box: string; icon: string }> = {
	ok: { box: "border-ok/45 bg-panel", icon: "text-ok" },
	bad: { box: "border-bad/55 bg-panel", icon: "text-bad" },
	warn: { box: "border-warn/60 bg-panel", icon: "text-warn" },
	live: {
		box: "border-accent-line bg-panel ring-4 ring-accent-soft",
		icon: "text-accent-text",
	},
	idle: { box: "border-line-2 bg-panel", icon: "text-fg-3" },
	next: {
		box: "border-dashed border-line-2 bg-transparent text-fg-2",
		icon: "text-fg-3",
	},
	you: { box: "border-warn bg-warn-soft", icon: "text-warn" },
};

function BoxNode({ data }: NodeProps<Node<Box>>) {
	const tone = TONE[data.tone];
	const Icon = data.icon;
	const [into, out] =
		data.dir === "LR"
			? [Position.Left, Position.Right]
			: [Position.Top, Position.Bottom];
	const body = (
		<>
			<Handle type="target" position={into} isConnectable={false} />
			<Icon className={`size-4 shrink-0 ${tone.icon}`} aria-hidden />
			<span className="min-w-0">
				<span
					className={`block truncate text-sm font-medium ${data.tone === "next" ? "text-fg-2" : "text-fg"}`}
				>
					{data.title}
				</span>
				{data.detail && (
					<span className="block truncate text-xs text-fg-2">
						{data.detail}
					</span>
				)}
			</span>
			<Handle type="source" position={out} isConnectable={false} />
		</>
	);
	const className = `flex items-center gap-3 border text-left no-underline shadow-1 transition-colors duration-150 ${data.event ? "rounded-full px-5" : "rounded-xl px-3.5"} ${data.event ? "border-ok/60 bg-panel ring-4 ring-ok-soft" : tone.box}`;
	const style = { width: W, height: H };
	return data.href ? (
		<a
			href={data.href}
			{...(data.external
				? { target: "_blank", rel: "noreferrer noopener" }
				: {})}
			className={`${className} hover:bg-hover`}
			style={style}
		>
			{body}
		</a>
	) : (
		<div className={className} style={style}>
			{body}
		</div>
	);
}

const nodeTypes = { box: BoxNode };

/** The key under the graph: each shape drawn small, as the boxes are; "Where it failed" only when a box is red. */
const LEGEND: {
	id: "trigger" | "done" | "failed" | "next" | "you";
	label: string;
	swatch: string;
}[] = [
	{
		id: "trigger",
		label: "What started the run",
		swatch: "rounded-full border-ok/60 bg-panel ring-2 ring-ok-soft",
	},
	{ id: "done", label: "Done", swatch: "rounded-[4px] border-ok/45 bg-panel" },
	{
		id: "failed",
		label: "Where it failed",
		swatch: "rounded-[4px] border-bad/55 bg-panel",
	},
	{
		id: "next",
		label: "Should come next",
		swatch: "rounded-[4px] border-dashed border-fg-3",
	},
	{
		id: "you",
		label: "Your turn",
		swatch: "rounded-[4px] border-warn bg-warn-soft",
	},
];

// Room on the right for the zoom buttons, so they never cover the last box.
const FIT = {
	padding: { x: 0.06, y: 0.06, right: "56px" },
	maxZoom: 1,
	minZoom: 0.55,
} as const;

/**
 * The run as a small graph, read left to right: what started it, what it did, what it
 * produced, and what comes after. Solid boxes happened; dashed boxes should come next.
 */
export function RunGraph({
	detail,
	steps,
}: {
	detail: RunDetail;
	steps: number;
}) {
	const [frame, width] = useWidth();
	const dir = width > 0 && width < 760 ? "TB" : "LR";

	const flow = useMemo(() => runFlow(detail, steps, dir), [detail, steps, dir]);
	const dark = useDark();

	return (
		<figure>
			<div
				ref={frame}
				className="flow-still relative overflow-hidden rounded-xl border border-line bg-sunken"
				// The frame takes the graph's height at the scale it is drawn, so no band stays empty.
				style={{
					height:
						Math.min(
							flow.height *
								Math.min(1, Math.max(0.55, (width - 32) / flow.width)),
							520,
						) + 88,
				}}
			>
				{width > 0 && (
					<ReactFlow
						// A new key fits the view again: on a resize, and when the graph grows.
						key={`${dir}-${Math.round(width)}-${flow.nodes.length}`}
						nodes={flow.nodes}
						edges={flow.edges}
						nodeTypes={nodeTypes}
						colorMode={dark ? "dark" : "light"}
						fitView
						fitViewOptions={FIT}
						minZoom={0.3}
						maxZoom={1.6}
						nodesDraggable={false}
						nodesConnectable={false}
						elementsSelectable={false}
						// As on the Workflow page: drag moves the graph; ⌘ or Ctrl with the wheel, or a pinch, zooms. The wheel alone scrolls the page.
						panOnDrag
						zoomOnScroll={false}
						zoomActivationKeyCode={["Meta", "Control"]}
						zoomOnPinch
						zoomOnDoubleClick={false}
						preventScrolling={false}
						proOptions={{ hideAttribution: true }}
					>
						<Controls
							showInteractive={false}
							position="bottom-right"
							fitViewOptions={FIT}
						/>
					</ReactFlow>
				)}
			</div>
			<figcaption className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-fg-2">
				{LEGEND.filter(
					(l) =>
						l.id !== "failed" || flow.nodes.some((n) => n.data.tone === "bad"),
				).map((l) => (
					<span key={l.id} className="inline-flex items-center gap-2">
						<span
							aria-hidden
							className={`h-3 w-5 shrink-0 border ${l.swatch}`}
						/>
						{l.label}
					</span>
				))}
				<span className="text-fg-3 sm:ml-auto">
					Drag to move · {MAC ? "⌘" : "Ctrl"} + scroll or pinch to zoom
				</span>
			</figcaption>
		</figure>
	);
}

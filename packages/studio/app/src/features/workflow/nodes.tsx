import type { WorkflowNode } from "@openfabriq/core";
import {
	BaseEdge,
	type Edge,
	EdgeLabelRenderer,
	type EdgeProps,
	Handle,
	type Node,
	type NodeProps,
	Position,
} from "@xyflow/react";
import { RotateCcw, UserRound } from "lucide-react";
import { useAgentHue } from "../../hooks/use-agent-hue.js";
import { EVENT_SHORT } from "../../lib/format.js";
import { eventIcon } from "../../lib/icons.js";
import type { Point } from "./flow-path.js";
import { eventWords, type Role, roleOf } from "./graph-words.js";
import { AUTOMATION, EVENT } from "./layout.js";

// The workflow's boxes and arrows, as React Flow draws them.

export interface Data {
	node: WorkflowNode;
	/** Another box has the focus and this one is not linked to it. */
	dim: boolean;
	/** The box with the focus. */
	focus: boolean;
	/** Seen from an area: an automation of elsewhere, one event away. */
	faded?: boolean;
	[key: string]: unknown;
}
export type FlowNode = Node<Data>;

export const ROLE_STYLE: Record<Role, string> = {
	start: "border-ok/60 bg-panel ring-4 ring-ok-soft",
	pass: "border-line-2 bg-panel",
	you: "border-warn bg-warn-soft",
	out: "border-dashed border-line-2 bg-bg",
};

const frame = (data: Data) =>
	`cursor-pointer shadow-1 transition-[opacity,outline-color] duration-200 outline-2 outline-offset-[3px] ${data.focus ? "outline-accent" : "outline-transparent"} ${data.dim ? "opacity-30" : ""}`;

function EventNode({ data }: NodeProps<FlowNode>) {
	const { node } = data;
	const role = roleOf(node);
	const Icon = role === "you" ? UserRound : eventIcon(node.title);
	return (
		<div
			className={`flex items-center gap-2.5 rounded-full border px-4 ${ROLE_STYLE[role]} ${frame(data)}`}
			style={EVENT}
			title={eventWords(node)}
		>
			<Handle type="target" position={Position.Top} isConnectable={false} />
			<Icon
				className={`size-4 shrink-0 ${role === "start" ? "text-ok" : role === "you" ? "text-warn" : "text-fg-3"}`}
				aria-hidden
			/>
			<span className="min-w-0">
				<span
					className={`block truncate text-sm font-medium ${role === "out" ? "text-fg-2" : "text-fg"}`}
				>
					{EVENT_SHORT[node.title] ?? node.title}
				</span>
				{node.detail && (
					<span className="block truncate text-xs text-fg-2">
						{node.detail}
					</span>
				)}
			</span>
			<Handle type="source" position={Position.Bottom} isConnectable={false} />
		</div>
	);
}

function AutomationNode({ data }: NodeProps<FlowNode>) {
	const agentHue = useAgentHue();
	const { node } = data;
	return (
		<div
			className={`flex items-center gap-3 rounded-xl border border-line-2 bg-panel px-3.5 ${frame(data)}`}
			style={AUTOMATION}
			title={[node.detail, node.title, node.area && `in ${node.area}`]
				.filter(Boolean)
				.join(" · ")}
		>
			<Handle type="target" position={Position.Top} isConnectable={false} />
			<span
				aria-hidden
				className="size-2.5 shrink-0 rounded-[3px]"
				style={{ background: agentHue(node.detail ?? node.title) }}
			/>
			<span className="min-w-0">
				<span className="block truncate text-sm font-semibold text-fg">
					{node.detail}
				</span>
				<span className="block truncate text-xs text-fg-2">
					{node.kind === "review" ? `reviews ${node.title}` : node.title}
					{data.faded && node.area ? ` · ${node.area}` : ""}
				</span>
			</span>
			{node.kind === "review" && (
				<RotateCcw
					className="ml-auto size-3.5 shrink-0 text-fg-3"
					aria-label="a loop: the change goes back until it is approved"
				/>
			)}
			<Handle type="source" position={Position.Bottom} isConnectable={false} />
		</div>
	);
}

/** An arrow along the lanes the layout left between boxes, so it never crosses one. */
function RoutedEdge({
	data,
	markerEnd,
	style,
}: EdgeProps<Edge<{ d: string; label?: string; at?: Point }>>) {
	return (
		<>
			<BaseEdge
				path={data?.d ?? ""}
				{...(markerEnd ? { markerEnd } : {})}
				{...(style ? { style } : {})}
			/>
			{data?.label && data.at && (
				<EdgeLabelRenderer>
					<span
						className="pointer-events-none absolute rounded-full border border-line-2 bg-panel px-2 py-0.5 text-2xs whitespace-nowrap text-fg-2 shadow-1"
						style={{
							// Written along the lane it climbs, bottom to top.
							transform: `translate(-50%, -50%) translate(${data.at.x}px, ${data.at.y}px) rotate(-90deg)`,
							opacity: style?.opacity ?? 1,
						}}
					>
						{data.label}
					</span>
				</EdgeLabelRenderer>
			)}
		</>
	);
}

// Outside the component: React Flow wants the same object on every render.
// A review is drawn as the agent's box it is: the reviewer, beside the automation it reviews.
export const nodeTypes = {
	event: EventNode,
	automation: AutomationNode,
	review: AutomationNode,
};
export const edgeTypes = { routed: RoutedEdge };

import type { CSSProperties, ReactNode } from "react";
import { agentColor, hueOf } from "@/lib/agent-color";
import { withArrows } from "./arrow";
import { Icon, type IconName } from "./icon";

// A flow in the studio's workflow style: events are pills (green when they start the factory,
// amber when a person acts), agents are boxes with their color.

/** A stable color per agent name, the studio's. */
const colorOf = (agent: string) => agentColor(hueOf(agent));

/** One box of a flow. `start`: the event that starts it all; `you`: a person acts. */
export interface FlowNode {
	event?: string;
	agent?: string;
	detail?: string;
	icon?: IconName;
	start?: boolean;
	you?: boolean;
}
/** Paths side by side, each going its own way to its end. On a phone, the first one comes last. */
interface FlowPaths {
	paths: FlowStep[][];
}
/** A box, several boxes side by side (a branch), paths, or the words on the next arrow. */
type FlowStep = FlowNode | FlowNode[] | FlowPaths | string;

const nodesOf = (steps: FlowStep[]): FlowNode[] =>
	steps.flatMap((step) =>
		typeof step === "string"
			? []
			: "paths" in step
				? step.paths.flatMap(nodesOf)
				: step,
	);

/** Steps top to bottom, an arrow between each. */
function column(steps: FlowStep[]): ReactNode[] {
	return withArrows(steps, (step) =>
		"paths" in step ? (
			<div className="flex flex-col-reverse items-center gap-6 sm:flex-row sm:items-start sm:justify-center sm:gap-4">
				{step.paths.map((path, j) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list.
					<div key={j} className="flex flex-col items-center">
						{column(path)}
					</div>
				))}
			</div>
		) : (
			<div className="flex flex-wrap justify-center gap-x-4 gap-y-3">
				{(Array.isArray(step) ? step : [step]).map((n) => (
					<Node key={`${n.event ?? n.agent}-${n.detail}`} node={n} />
				))}
			</div>
		),
	);
}

function Node({ node }: { node: FlowNode }) {
	if (node.agent)
		return (
			<div className="flex min-w-48 items-center gap-3 rounded-xl border bg-fd-card px-4 py-2.5 shadow-sm">
				<span
					aria-hidden
					className="size-2.5 shrink-0 rounded-[3px]"
					style={{ background: colorOf(node.agent) }}
				/>
				<span className="min-w-0 text-left">
					<span className="block text-sm font-semibold">{node.agent}</span>
					{node.detail && (
						<span className="mt-0.5 block text-xs text-fd-muted-foreground">
							{node.detail}
						</span>
					)}
				</span>
			</div>
		);
	const tone = node.you
		? "border-amber-500/70 bg-amber-500/10"
		: node.start
			? "border-emerald-500/60 bg-fd-card ring-4 ring-emerald-500/10"
			: "bg-fd-card";
	const iconTone = node.you
		? "text-amber-600 dark:text-amber-400"
		: node.start
			? "text-emerald-600 dark:text-emerald-400"
			: "text-fd-muted-foreground";
	return (
		<div
			className={`flex items-center gap-2.5 rounded-full border px-4.5 py-2 shadow-sm ${tone}`}
		>
			<Icon
				name={node.icon ?? (node.you ? "you" : "event")}
				className={`size-4 ${iconTone}`}
			/>
			<span className="min-w-0 text-left">
				<span className="block text-sm font-medium">{node.event}</span>
				{node.detail && (
					<span className="block text-xs text-fd-muted-foreground">
						{node.detail}
					</span>
				)}
			</span>
		</div>
	);
}

/** A key's sample in the legend: a pill, or an agent's square. */
type LegendSwatch = { className: string; style?: CSSProperties };

/** What the colors of a flow mean, for the kinds of boxes it shows. */
function Legend({ nodes }: { nodes: FlowNode[] }) {
	// The agents' own squares, as in their boxes: the color names the agent, not a status.
	const agents = [...new Set(nodes.flatMap((n) => (n.agent ? [n.agent] : [])))];
	const pill = (color: string): LegendSwatch[] => [
		{ className: `rounded-full border ${color}` },
	];
	const keys = [
		nodes.some((n) => n.start) && {
			label: "Starts the factory",
			marks: pill("border-emerald-500/60 bg-emerald-500/15"),
		},
		nodes.some((n) => n.you) && {
			label: "A person acts",
			marks: pill("border-amber-500/70 bg-amber-500/15"),
		},
		agents.length > 0 && {
			label: agents.length > 1 ? "An agent, each in its color" : "An agent",
			marks: agents.map(
				(a): LegendSwatch => ({
					className: "rounded-[3px]",
					style: { background: colorOf(a) },
				}),
			),
		},
	].filter((key) => key !== false);
	if (keys.length < 2) return null;
	return (
		<ul className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-1.5 text-xs text-fd-muted-foreground">
			{keys.map((key) => (
				<li key={key.label} className="flex items-center gap-1.5">
					<span aria-hidden className="flex gap-0.5">
						{key.marks.map((mark, i) => (
							<span
								// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list.
								key={i}
								className={`inline-block size-2.5 ${mark.className}`}
								style={mark.style}
							/>
						))}
					</span>
					{key.label}
				</li>
			))}
		</ul>
	);
}

/** Events and agents top to bottom, each arrow with what makes the next step happen. */
export function Flow({
	steps,
	caption,
	className = "my-8",
}: {
	steps: FlowStep[];
	caption?: ReactNode;
	className?: string;
}) {
	return (
		<figure
			className={`not-prose rounded-xl border bg-fd-secondary/40 px-4 py-8 sm:px-8 ${className}`}
		>
			<div className="flex flex-col items-center">{column(steps)}</div>
			<Legend nodes={nodesOf(steps)} />
			{caption && (
				<figcaption className="mx-auto mt-4 max-w-prose text-center text-sm text-fd-muted-foreground">
					{caption}
				</figcaption>
			)}
		</figure>
	);
}

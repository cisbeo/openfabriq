import { type ReactNode, useId } from "react";
import { useAgentHue } from "../hooks/use-agent-hue.js";
import { useNow } from "../hooks/use-now.js";
import { duration } from "../lib/format.js";

// Small marks beside a run or an agent: its status, its agent, how long, a hint.

const STATUS_STYLE: Record<string, string> = {
	succeeded: "text-ok",
	applied: "text-ok",
	failed: "text-bad",
	refused: "text-warn",
	running: "text-accent-text",
	queued: "text-fg-2",
	skipped: "text-fg-3",
	ready: "text-ok",
	missing: "text-warn",
};

/** A status as a colored dot and its word: color never speaks alone. */
export function Status({
	status,
	className = "",
}: {
	status: string;
	className?: string;
}) {
	const live = status === "running";
	return (
		<span
			className={`inline-flex items-center gap-1.5 text-sm font-medium capitalize ${STATUS_STYLE[status] ?? "text-fg-2"} ${className}`}
		>
			<span className="relative flex size-2 shrink-0" aria-hidden>
				{live && (
					<span
						className="absolute inset-0 rounded-full bg-current opacity-60"
						style={{
							animation: "ping-dot 1.4s cubic-bezier(0,0,0.2,1) infinite",
						}}
					/>
				)}
				<span
					className={`relative size-2 rounded-full ${status === "queued" || status === "skipped" ? "border-[1.5px] border-current" : "bg-current"}`}
				/>
			</span>
			{status}
		</span>
	);
}

/** A status as a soft pill, for headers and outcomes where a dot is too quiet. */
export function Pill({ status }: { status: string }) {
	return (
		<span
			className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium capitalize ${PILL_STYLE[status] ?? "bg-hover text-fg-2"}`}
		>
			{status === "running" ? (
				<span className="relative flex size-1.5" aria-hidden>
					<span
						className="absolute inset-0 rounded-full bg-current opacity-60"
						style={{
							animation: "ping-dot 1.4s cubic-bezier(0,0,0.2,1) infinite",
						}}
					/>
					<span className="relative size-1.5 rounded-full bg-current" />
				</span>
			) : (
				<span className="size-1.5 rounded-full bg-current" aria-hidden />
			)}
			{status}
		</span>
	);
}

/** An agent's name with its colored mark. */
export function AgentTag({
	name,
	className = "",
}: {
	name: string;
	className?: string;
}) {
	const agentHue = useAgentHue();
	return (
		<span
			className={`inline-flex min-w-0 items-center gap-1.5 text-xs text-fg-2 ${className}`}
		>
			<span
				aria-hidden
				className="size-2 shrink-0 rounded-[3px]"
				style={{ background: agentHue(name) }}
			/>
			<span className="truncate">{name}</span>
		</span>
	);
}

/** How long since `since`, ticking every second: for work in progress. */
export function Elapsed({ since }: { since: string }) {
	const now = useNow();
	return <>{duration(Math.max(0, now - new Date(since).getTime()))}</>;
}

const PILL_STYLE: Record<string, string> = {
	succeeded: "bg-ok-soft text-ok",
	applied: "bg-ok-soft text-ok",
	failed: "bg-bad-soft text-bad",
	refused: "bg-warn-soft text-warn",
	running: "bg-accent-soft text-accent-text",
	queued: "bg-hover text-fg-2",
	skipped: "bg-hover text-fg-3",
};

/** A chip that says what it means, one hover or focus away: a tooltip under it, aligned right. */
export function HintChip({
	icon,
	label,
	hint,
}: {
	icon: ReactNode;
	label: string;
	hint: string;
}) {
	const id = useId();
	return (
		<span className="group/hint relative inline-flex">
			<button type="button" aria-describedby={id} className="chip cursor-help">
				{icon}
				{label}
			</button>
			<span
				id={id}
				role="tooltip"
				className="pointer-events-none invisible absolute top-full right-0 z-20 mt-2 block w-64 translate-y-1 rounded-xl border border-line bg-panel px-3.5 py-3 text-xs font-normal text-pretty text-fg-2 opacity-0 shadow-pop transition-[opacity,translate,visibility] duration-150 ease-out group-focus-within/hint:visible group-focus-within/hint:translate-y-0 group-focus-within/hint:opacity-100 group-hover/hint:visible group-hover/hint:translate-y-0 group-hover/hint:opacity-100"
			>
				{hint}
			</span>
		</span>
	);
}

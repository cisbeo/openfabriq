import { ChevronRight, LoaderCircle, Wrench } from "lucide-react";
import { ICONS } from "../../lib/icons.js";
import { runHref } from "../../lib/route.js";
import { runIds, show, summaryOf, type ToolCallPart } from "./tool-parts.js";

// A tool an agent used to work, as the chat and a run's log show it.

/** A block of fixed text: a command, a file, a tool's result. */
export function Code({
	children,
	tone,
}: {
	children: string;
	tone?: "bad" | undefined;
}) {
	return (
		<pre
			className={`max-h-80 overflow-auto rounded-lg border px-3 py-2.5 font-mono text-xs leading-5 whitespace-pre-wrap break-words ${tone === "bad" ? "border-bad/25 bg-bad-soft text-fg" : "border-line bg-sunken text-fg-2"}`}
		>
			{children}
		</pre>
	);
}

/** The arguments a person wants to see: the command, the change, else the JSON. */
export function Input({ part }: { part: ToolCallPart }) {
	const a = part.args;
	if (part.toolName === "Bash" && typeof a.command === "string")
		return <Code>{`$ ${a.command}`}</Code>;
	if (
		(part.toolName === "Edit" || part.toolName === "MultiEdit") &&
		typeof a.old_string === "string" &&
		typeof a.new_string === "string"
	)
		return (
			<pre className="max-h-80 overflow-auto rounded-lg border border-line bg-sunken py-2 font-mono text-xs leading-5">
				{a.old_string.split("\n").map((l, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: lines of a fixed text
					<div key={`o${i}`} className="bg-bad-soft px-3 text-fg">
						<span className="mr-2 text-bad select-none">-</span>
						{l}
					</div>
				))}
				{a.new_string.split("\n").map((l, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: lines of a fixed text
					<div key={`n${i}`} className="bg-ok-soft px-3 text-fg">
						<span className="mr-2 text-ok select-none">+</span>
						{l}
					</div>
				))}
			</pre>
		);
	if (part.toolName === "Write" && typeof a.content === "string")
		return <Code>{a.content}</Code>;
	const text = part.argsText ?? JSON.stringify(a, null, 2);
	return text && text !== "{}" ? <Code>{text}</Code> : null;
}

/** The runs a chat tool listed or read, as links to their pages. */
function RunLinks({ part }: { part: ToolCallPart }) {
	if (part.toolName !== "list_runs" && part.toolName !== "read_run")
		return null;
	const ids = runIds(part);
	if (ids.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-1.5">
			{ids.map((id) => (
				<a
					key={id}
					href={runHref(id)}
					className="chip font-mono text-fg no-underline hover:border-line-2"
				>
					{id}
				</a>
			))}
		</div>
	);
}

/** A tool the agent used to work: one line, opened for its input and result. */
export function ToolCall({ part }: { part: ToolCallPart }) {
	const { title, detail } = summaryOf(part);
	const Icon = ICONS[part.toolName] ?? Wrench;
	const running = part.status?.type === "running" && part.result === undefined;
	return (
		<details
			id={`tool-${part.toolCallId}`}
			className="group/tool scroll-mt-24 rounded-md"
		>
			<summary className="flex h-8 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm transition-colors duration-150 hover:bg-hover [&::-webkit-details-marker]:hidden">
				<ChevronRight
					className="size-3.5 shrink-0 text-fg-3 transition-transform duration-150 group-open/tool:rotate-90"
					aria-hidden
				/>
				<Icon className="size-3.5 shrink-0 text-fg-2" aria-hidden />
				<span className="shrink-0 font-medium text-fg">{title}</span>
				{detail && (
					<span className="min-w-0 truncate font-mono text-xs text-fg-2">
						{detail}
					</span>
				)}
				<span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
					{part.isError && (
						<span className="text-xs font-medium text-bad">failed</span>
					)}
					{running && (
						<LoaderCircle
							className="size-3.5 animate-spin text-fg-3"
							aria-label="Running"
						/>
					)}
				</span>
			</summary>
			<div className="space-y-2 pt-1 pr-2 pb-3 pl-[42px]">
				<RunLinks part={part} />
				<Input part={part} />
				{part.result !== undefined && (
					<Code tone={part.isError ? "bad" : undefined}>
						{show(part.result) || "(no output)"}
					</Code>
				)}
			</div>
		</details>
	);
}

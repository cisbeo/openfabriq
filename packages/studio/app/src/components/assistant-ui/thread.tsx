import {
	ActionBarPrimitive,
	AuiIf,
	ErrorPrimitive,
	MessagePrimitive,
	ThreadPrimitive,
	useAuiState,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { Brain, Check, ChevronRight, Copy } from "lucide-react";
import { memo, type ReactNode, useState } from "react";
import remarkGfm from "remark-gfm";
import { useNow } from "../../hooks/use-now.js";
import { duration, money } from "../../lib/format.js";
import { MARKDOWN } from "../markdown.js";
import { OutputCall } from "./output.js";
import { ToolCall } from "./tool-call.js";
import {
	isOutput,
	stepsLine,
	summaryOf,
	type ToolCallPart,
} from "./tool-parts.js";

// The messages of a conversation, built from assistant-ui primitives, styled with the app's
// tokens: the chat shows a thread of them, a run's page its agent's.

const REMARK = [remarkGfm];

/** Markdown of a text part. No raw HTML: what an agent writes is data. */
const MarkdownText = memo(function MarkdownText() {
	return (
		<MarkdownTextPrimitive
			className="prose"
			remarkPlugins={REMARK}
			skipHtml
			components={MARKDOWN}
		/>
	);
});

/** Tool calls in a row: one block, open while the agent works, folded to one line after. */
function Steps({
	indices,
	children,
}: {
	indices: readonly number[];
	children: ReactNode;
}) {
	const parts = useAuiState((s) => s.message.parts);
	const running = useAuiState((s) => s.message.status?.type === "running");
	const [toggled, setToggled] = useState<boolean>();
	const open = toggled ?? running;
	const calls = indices
		.map((i) => parts[i])
		.filter((p): p is (typeof parts)[number] & ToolCallPart =>
			Boolean(p && p.type === "tool-call"),
		);
	const failed = calls.filter((c) => c.isError).length;
	const count = calls.length;
	return (
		<div className="my-3 rounded-xl border border-line bg-panel shadow-1">
			<button
				type="button"
				onClick={() => setToggled(!open)}
				aria-expanded={open}
				className="flex min-h-9 w-full items-center gap-2 rounded-xl px-3 text-left text-sm transition-colors duration-150 hover:bg-hover"
			>
				<ChevronRight
					className={`size-3.5 shrink-0 text-fg-3 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
					aria-hidden
				/>
				<span className="shrink-0 font-medium text-fg-2">
					{count} {count === 1 ? "step" : "steps"}
				</span>
				{!open && (
					<span className="min-w-0 truncate text-fg-3">{stepsLine(calls)}</span>
				)}
				{failed > 0 && (
					<span className="ml-auto shrink-0 text-xs font-medium text-bad">
						{failed} failed
					</span>
				)}
			</button>
			{open && <div className="px-1 pb-1">{children}</div>}
		</div>
	);
}

/** While the answer is being written: what the agent is doing, and for how long. */
function Working() {
	const running = useAuiState((s) => s.message.status?.type === "running");
	const lastType = useAuiState((s) => s.message.parts.at(-1)?.type);
	const tool = useAuiState((s) => {
		const last = s.message.parts.at(-1);
		return last?.type === "tool-call" && last.result === undefined
			? summaryOf(last as unknown as ToolCallPart).title
			: undefined;
	});
	const since = useAuiState((s) => s.message.createdAt.getTime());
	const now = useNow();
	if (!running || lastType === "text") return null;
	return (
		<p className="mt-2 flex items-center gap-2 text-sm" aria-live="polite">
			<span className="relative flex size-2" aria-hidden>
				<span
					className="absolute inset-0 rounded-full bg-accent opacity-60"
					style={{
						animation: "ping-dot 1.4s cubic-bezier(0,0,0.2,1) infinite",
					}}
				/>
				<span className="relative size-2 rounded-full bg-accent" />
			</span>
			<span className="shimmer font-medium">
				{tool ? `${tool}…` : lastType === undefined ? "Thinking…" : "Working…"}
			</span>
			<span className="tnum text-xs text-fg-3">
				{duration(Math.max(0, now - since))}
			</span>
		</p>
	);
}

function Reasoning({ text }: { text: string }) {
	return (
		<details className="group/think my-2">
			<summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1 text-sm text-fg-2 hover:text-fg [&::-webkit-details-marker]:hidden">
				<Brain className="size-3.5" aria-hidden />
				Thinking
				<ChevronRight
					className="size-3.5 transition-transform duration-150 group-open/think:rotate-90"
					aria-hidden
				/>
			</summary>
			<div className="mt-1 border-l border-line-2 pl-4 text-sm whitespace-pre-wrap text-fg-2">
				{text}
			</div>
		</details>
	);
}

/** Tool calls in a row become one block of steps; proposed outputs stand on their own. */
function AssistantParts() {
	return (
		<MessagePrimitive.GroupedParts
			groupBy={(part) =>
				part.type === "tool-call" && !isOutput(part.toolName)
					? ["group-steps"]
					: null
			}
		>
			{({ part, children }) => {
				switch (part.type) {
					case "group-steps":
						return (
							<Steps indices={"indices" in part ? part.indices : []}>
								{children}
							</Steps>
						);
					case "text":
						return <MarkdownText />;
					case "reasoning":
						return "text" in part ? <Reasoning text={part.text} /> : null;
					case "tool-call": {
						const call = part as unknown as ToolCallPart;
						return isOutput(call.toolName) ? (
							<OutputCall part={call} />
						) : (
							<ToolCall part={call} />
						);
					}
					default:
						return null;
				}
			}}
		</MessagePrimitive.GroupedParts>
	);
}

/** Cost and time of a chat answer, and a copy button, quiet, once it is done. */
function AnswerFooter() {
	const custom = useAuiState(
		(s) =>
			s.message.metadata.custom as { costUsd?: number; durationMs?: number },
	);
	const facts = [
		custom.costUsd !== undefined ? money(custom.costUsd) : undefined,
		custom.durationMs !== undefined ? duration(custom.durationMs) : undefined,
	].filter(Boolean);
	return (
		<AuiIf condition={(s) => s.message.status?.type !== "running"}>
			<div className="mt-2 flex h-7 items-center gap-2 text-fg-3">
				<ActionBarPrimitive.Root hideWhenRunning className="flex items-center">
					<ActionBarPrimitive.Copy
						aria-label="Copy the answer"
						className="inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-hover hover:text-fg"
					>
						<AuiIf condition={(s) => s.message.isCopied}>
							<Check className="size-3.5 text-ok" aria-hidden />
						</AuiIf>
						<AuiIf condition={(s) => !s.message.isCopied}>
							<Copy className="size-3.5" aria-hidden />
						</AuiIf>
					</ActionBarPrimitive.Copy>
				</ActionBarPrimitive.Root>
				{facts.length > 0 && (
					<span className="tnum text-2xs">{facts.join(" · ")}</span>
				)}
			</div>
		</AuiIf>
	);
}

export function AssistantMessage({ footer = false }: { footer?: boolean }) {
	return (
		<MessagePrimitive.Root className="rise relative">
			<AssistantParts />
			<Working />
			<MessagePrimitive.Error>
				<ErrorPrimitive.Root className="mt-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-fg">
					<ErrorPrimitive.Message />
				</ErrorPrimitive.Root>
			</MessagePrimitive.Error>
			{footer && <AnswerFooter />}
		</MessagePrimitive.Root>
	);
}

/** A person's message in the chat. */
export function UserMessage() {
	return (
		<MessagePrimitive.Root className="rise flex justify-end">
			<div className="max-w-[85%] rounded-2xl rounded-br-md bg-hover px-4 py-2.5 whitespace-pre-wrap text-fg">
				<MessagePrimitive.Parts>
					{({ part }) => (part.type === "text" ? <MarkdownText /> : null)}
				</MessagePrimitive.Parts>
			</div>
		</MessagePrimitive.Root>
	);
}

/** The messages of a thread, laid out in the page's flow. */
export function Messages({ footer }: { footer?: boolean }) {
	return (
		<ThreadPrimitive.Messages>
			{({ message }) =>
				message.role === "user" ? (
					<UserMessage />
				) : (
					<AssistantMessage footer={footer ?? false} />
				)
			}
		</ThreadPrimitive.Messages>
	);
}

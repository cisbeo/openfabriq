import type { WorkflowGraph, WorkflowNode } from "@openfabriq/core";
import { ArrowRight, UserRound, X } from "lucide-react";
import type { ReactNode } from "react";
import { useAgentHue } from "../../hooks/use-agent-hue.js";
import { ACTION_WORDS } from "../../lib/format.js";
import { eventIcon } from "../../lib/icons.js";
import { agentHref, runsHref } from "../../lib/route.js";
import {
	comesNext,
	edgesFrom,
	edgesInto,
	eventSentence,
	eventWords,
	originWords,
	permission,
	roleOf,
} from "./graph-words.js";
import { ROLE_STYLE } from "./nodes.js";
import type { PersonLoop } from "./person-loops.js";

function Chip({
	node,
	onSelect,
}: {
	node: WorkflowNode;
	onSelect: (id: string) => void;
}) {
	const agentHue = useAgentHue();
	const Icon =
		roleOf(node) === "you"
			? UserRound
			: node.kind === "event"
				? eventIcon(node.title)
				: undefined;
	return (
		<button
			type="button"
			onClick={() => onSelect(node.id)}
			className={`inline-flex h-8 max-w-full items-center gap-2 border px-3 text-left text-sm text-fg transition-colors duration-150 hover:bg-hover ${node.kind === "event" ? "rounded-full" : "rounded-lg"} ${node.kind === "event" ? ROLE_STYLE[roleOf(node)] : "border-line-2 bg-panel"}`}
		>
			{Icon ? (
				<Icon className="size-3.5 shrink-0 text-fg-2" aria-hidden />
			) : (
				<span
					aria-hidden
					className="size-2 shrink-0 rounded-[3px]"
					style={{ background: agentHue(node.detail ?? node.title) }}
				/>
			)}
			<span className="truncate">
				{node.kind === "event" ? eventWords(node) : node.detail}
			</span>
		</button>
	);
}

function Part({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="border-t border-line pt-4">
			<h3 className="mb-2.5 text-xs font-medium text-fg-2">{title}</h3>
			{children}
		</section>
	);
}

type Chips = (ids: string[]) => ReactNode;
type Select = (id: string | undefined) => void;

/** The selected box in words: what starts it, what it does, what comes after. */
export function Inspector({
	graph,
	loops,
	id,
	project,
	onSelect,
}: {
	graph: WorkflowGraph;
	loops: PersonLoop[];
	id: string | undefined;
	project: string;
	onSelect: Select;
}) {
	const byId = new Map(graph.nodes.map((n) => [n.id, n]));
	const node = id ? byId.get(id) : undefined;
	const chips: Chips = (ids) => (
		<div className="flex flex-wrap gap-1.5">
			{[...new Set(ids)].map((n) => {
				const target = byId.get(n);
				return target ? (
					<Chip key={n} node={target} onSelect={onSelect} />
				) : null;
			})}
		</div>
	);

	if (!node) return <Overview graph={graph} chips={chips} />;
	if (node.kind === "review")
		return (
			<ReviewBox
				node={node}
				author={byId.get(`automation:${node.title}`)?.detail ?? ""}
				project={project}
				chips={chips}
				onSelect={onSelect}
			/>
		);
	if (node.kind === "automation")
		return (
			<AutomationBox
				graph={graph}
				node={node}
				project={project}
				chips={chips}
				onSelect={onSelect}
			/>
		);
	return (
		<EventBox
			graph={graph}
			loops={loops}
			node={node}
			byId={byId}
			chips={chips}
			onSelect={onSelect}
		/>
	);
}

/** Nothing selected: where work starts, the automations, where it reaches a person. */
function Overview({ graph, chips }: { graph: WorkflowGraph; chips: Chips }) {
	const starts = graph.nodes.filter((n) => n.entry);
	const automations = graph.nodes.filter((n) => n.kind === "automation");
	const you = graph.nodes.filter((n) => roleOf(n) === "you");
	return (
		<div className="space-y-4">
			<p className="text-sm text-pretty text-fg-2">
				Work comes in at the top and goes down, one automation at a time, until
				it reaches a person. Select a box to see what it does.
			</p>
			<Part title="Work starts here">{chips(starts.map((n) => n.id))}</Part>
			<Part title="Automations">{chips(automations.map((n) => n.id))}</Part>
			{you.length > 0 && (
				<Part title="It reaches you">{chips(you.map((n) => n.id))}</Part>
			)}
		</div>
	);
}

function Close({ onSelect }: { onSelect: Select }) {
	return (
		<button
			type="button"
			onClick={() => onSelect(undefined)}
			aria-label="Close"
			className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg"
		>
			<X className="size-4" aria-hidden />
		</button>
	);
}

/** An automation: what starts it, what it may write, what can come next. */
function AutomationBox({
	graph,
	node,
	project,
	chips,
	onSelect,
}: {
	graph: WorkflowGraph;
	node: WorkflowNode;
	project: string;
	chips: Chips;
	onSelect: Select;
}) {
	const agentHue = useAgentHue();
	const agent = node.detail ?? "";
	const next = comesNext(graph, node.id);
	return (
		<div className="space-y-4">
			<header className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="flex items-center gap-2 text-base font-semibold text-fg">
						<span
							aria-hidden
							className="size-2.5 shrink-0 rounded-[3px]"
							style={{ background: agentHue(agent) }}
						/>
						{agent}
					</p>
					<p className="mt-0.5 font-mono text-xs text-fg-2">
						{node.title}
						{node.area && <span className="font-sans"> · in {node.area}</span>}
					</p>
				</div>
				<Close onSelect={onSelect} />
			</header>
			<Part title="Starts when">
				{chips(
					edgesInto(graph, node.id)
						.filter((e) => !e.source.startsWith("review:"))
						.map((e) => e.source),
				)}
			</Part>
			{graph.nodes.some((n) => n.id === `review:${node.title}`) && (
				<Part title="Reviewed before it leaves">
					{chips([`review:${node.title}`])}
				</Part>
			)}
			<Part title="May write on GitHub">
				{node.can && node.can.length > 0 ? (
					<ul className="space-y-1.5 text-sm text-fg">
						{node.can.map((c) => {
							const p = permission(c);
							return (
								<li key={c} className="flex flex-wrap items-center gap-1.5">
									<span>{ACTION_WORDS[p.action] ?? p.action}</span>
									{p.labels.map((l) => (
										<span key={l} className="chip font-mono">
											{l}
										</span>
									))}
								</li>
							);
						})}
					</ul>
				) : (
					<p className="text-sm text-fg-2">Nothing: it only reads.</p>
				)}
			</Part>
			{next.length > 0 && <Part title="What can come next">{chips(next)}</Part>}
			<div className="flex flex-wrap gap-2 border-t border-line pt-4">
				<a href={agentHref(agent, project)} className="btn no-underline">
					Agent page
					<ArrowRight className="size-3.5 text-fg-2" aria-hidden />
				</a>
				<a href={runsHref({ project, agent })} className="btn no-underline">
					Its runs
					<ArrowRight className="size-3.5 text-fg-2" aria-hidden />
				</a>
			</div>
		</div>
	);
}

/** A review (reviewed_by): the agent that reads an automation's change before it leaves the machine. */
function ReviewBox({
	node,
	author,
	project,
	chips,
	onSelect,
}: {
	node: WorkflowNode;
	author: string;
	project: string;
	chips: Chips;
	onSelect: Select;
}) {
	const agentHue = useAgentHue();
	const reviewer = node.detail ?? "";
	return (
		<div className="space-y-4">
			<header className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="flex items-center gap-2 text-base font-semibold text-fg">
						<span
							aria-hidden
							className="size-2.5 shrink-0 rounded-[3px]"
							style={{ background: agentHue(reviewer) }}
						/>
						{reviewer}
					</p>
					<p className="mt-0.5 text-xs text-fg-2">
						reviews <span className="font-mono">{node.title}</span>
					</p>
				</div>
				<Close onSelect={onSelect} />
			</header>
			<p className="text-sm text-pretty text-fg">
				When {author} is done, {reviewer} reads the change before it leaves this
				machine, and gives a verdict. Needs changes sends it back to {author};
				approved lets the pull request out; a person is needed, or too many
				rounds, and the pull request opens with needs-human. It writes nothing
				on GitHub.
			</p>
			<Part title="Reviews the work of">
				{chips([`automation:${node.title}`])}
			</Part>
			<div className="flex flex-wrap gap-2 border-t border-line pt-4">
				<a href={agentHref(reviewer, project)} className="btn no-underline">
					Agent page
					<ArrowRight className="size-3.5 text-fg-2" aria-hidden />
				</a>
			</div>
		</div>
	);
}

/** An event: who makes it happen, and who picks it up. */
function EventBox({
	graph,
	loops,
	node,
	byId,
	chips,
	onSelect,
}: {
	graph: WorkflowGraph;
	loops: PersonLoop[];
	node: WorkflowNode;
	byId: Map<string, WorkflowNode>;
	chips: Chips;
	onSelect: Select;
}) {
	const role = roleOf(node);
	const makers = edgesInto(graph, node.id);
	const listeners = edgesFrom(graph, node.id).map((e) => e.target);
	const loop = loops.find((l) => l.source === node.id);
	return (
		<div className="space-y-4">
			<header className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-base font-semibold text-fg">{eventWords(node)}</p>
					<p className="mt-0.5 text-sm text-fg-2">{eventSentence(node)}</p>
				</div>
				<Close onSelect={onSelect} />
			</header>
			<Part title="Who makes it happen">
				{makers.length > 0 ? (
					<ul className="space-y-1.5">
						{makers.map((e) => {
							const a = byId.get(e.source);
							return a ? (
								<li key={e.id} className="flex flex-wrap items-center gap-2">
									<Chip node={a} onSelect={onSelect} />
									{e.label && (
										<span className="text-xs text-fg-2">
											{(ACTION_WORDS[e.label] ?? e.label).toLowerCase()}
										</span>
									)}
								</li>
							) : null;
						})}
					</ul>
				) : (
					<p className="text-sm text-fg-2">{originWords(node)}</p>
				)}
			</Part>
			<Part title="Who picks it up">
				{listeners.length > 0 ? (
					chips(listeners)
				) : loop ? (
					<div className="space-y-2.5">
						<p className="text-sm text-pretty text-fg-2">
							A person first. When {loop.who} answers with a comment,{" "}
							{loop.automations.length === 1
								? "this automation runs"
								: "these automations run"}{" "}
							again:
						</p>
						{chips([
							loop.target,
							...loop.automations.map((a) => `automation:${a}`),
						])}
					</div>
				) : (
					<p className="text-sm text-pretty text-fg-2">
						{role === "you"
							? "Nobody in the factory: it waits for you. The board lists it under Needs you."
							: "Nobody in the factory: the work leaves it here, for a person."}
					</p>
				)}
			</Part>
		</div>
	);
}

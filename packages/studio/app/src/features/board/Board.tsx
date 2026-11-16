import {
	CircleCheck,
	CircleDot,
	Clock3,
	Hand,
	type LucideIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { ErrorNote, Skeleton } from "../../components/feedback.js";
import { PageHeader } from "../../components/page-layout.js";
import { SearchInput } from "../../components/search-input.js";
import { useAgentHue } from "../../hooks/use-agent-hue.js";
import { useApi } from "../../hooks/use-api.js";
import { query } from "../../lib/api.js";
import { dragToScroll } from "../../lib/drag-scroll.js";
import { boardHref, runsHref } from "../../lib/route.js";
import type { BoardCard, Board as BoardData, Stage } from "../../lib/types.js";
import { Card } from "./BoardCard.js";
import { filterStages, shownCards, stageCount } from "./board-view.js";

const STAGE: Record<
	Stage,
	{ name: string; icon: LucideIcon; tone: string; empty: string }
> = {
	waiting: {
		name: "Waiting",
		icon: Clock3,
		tone: "text-fg-3",
		empty: "Nothing in line. Runs wait here for a free slot.",
	},
	working: {
		name: "Working",
		icon: CircleDot,
		tone: "text-accent-text",
		empty: "No agent is working right now.",
	},
	"needs-you": {
		name: "Needs you",
		icon: Hand,
		tone: "text-warn",
		empty: "Nothing to look at. Failed runs and handed-over work land here.",
	},
	done: {
		name: "Done",
		icon: CircleCheck,
		tone: "text-ok",
		empty: "Finished work shows up here.",
	},
};

function Column({
	stage,
	cards: all,
	project,
	agent,
}: {
	stage: Stage;
	cards: BoardCard[];
	project: string | undefined;
	agent: string | undefined;
}) {
	const { name, icon: Icon, tone, empty } = STAGE[stage];
	const { cards, older } = shownCards(stage, all);
	return (
		<section
			aria-label={name}
			className="flex min-w-0 flex-col rounded-2xl bg-sunken ring-1 ring-line md:min-h-[240px] lg:min-h-0"
		>
			<h2 className="flex items-center gap-2 px-4 pt-3.5 pb-2 text-sm font-semibold">
				<Icon className={`size-4 ${tone}`} aria-hidden />
				{name}
				<span className="tnum ml-auto rounded-full bg-panel px-2 py-px text-xs font-medium text-fg-2 ring-1 ring-line">
					{all.length}
				</span>
			</h2>
			{cards.length === 0 ? (
				<p className="mx-2 mt-1 mb-2 flex flex-1 items-center justify-center rounded-xl border border-dashed border-line-2 px-6 py-8 text-center text-xs text-pretty text-fg-3">
					{empty}
				</p>
			) : (
				// pt-1: room for a hovered card's lift, which the scrolling list would clip.
				<ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pt-1 pb-2">
					{cards.map((card) => (
						<Card
							key={card.run.id}
							card={card}
							stage={stage}
							project={project}
						/>
					))}
				</ul>
			)}
			{older > 0 && (
				<a
					href={runsHref({ project, agent })}
					className="mx-2 mb-2 rounded-lg px-2 py-1.5 text-center text-xs text-fg-2 no-underline hover:bg-hover hover:text-fg"
				>
					{older} older in Runs →
				</a>
			)}
		</section>
	);
}

/** Every agent, what it is doing now; a click shows only its cards. */
function Agents({
	data,
	agent,
	href,
}: {
	data: BoardData;
	agent: string | undefined;
	href: (agent?: string) => string;
}) {
	const agentHue = useAgentHue();
	const chip =
		"inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-sm no-underline transition-colors duration-150";
	const on = "border-line-2 bg-panel text-fg shadow-1";
	const off = "border-transparent text-fg-2 hover:bg-hover hover:text-fg";
	return (
		<nav
			ref={dragToScroll}
			aria-label="Agents"
			className="-mx-4 flex min-w-0 flex-1 gap-1 overflow-x-auto px-4 pb-1 sm:-mx-8 sm:px-8 lg:mx-0 lg:px-0 lg:[mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)] [scrollbar-width:none]"
		>
			<a
				href={href()}
				aria-current={agent ? undefined : "true"}
				className={`${chip} ${agent ? off : on}`}
			>
				All agents
			</a>
			{data.agents.map((a) => (
				<a
					key={a.name}
					href={href(a.name)}
					aria-current={agent === a.name ? "true" : undefined}
					className={`${chip} ${agent === a.name ? on : off}`}
				>
					<span className="relative flex size-2" aria-hidden>
						{a.working > 0 && (
							<span
								className="absolute inset-0 rounded-[3px] opacity-60"
								style={{
									background: agentHue(a.name),
									animation: "ping-dot 1.4s cubic-bezier(0,0,0.2,1) infinite",
								}}
							/>
						)}
						<span
							className="relative size-2 rounded-[3px]"
							style={{ background: agentHue(a.name) }}
						/>
					</span>
					{a.name}
					<span className="tnum text-xs text-fg-3">
						{a.working > 0
							? "working"
							: a.waiting > 0
								? `${a.waiting} waiting`
								: "idle"}
					</span>
				</a>
			))}
		</nav>
	);
}

function Summary({ data }: { data: BoardData }) {
	const count = (s: Stage) => stageCount(data, s);
	const parts: ReactNode[] = [
		<span key="w" className="inline-flex items-center gap-1.5">
			<span
				className={`size-1.5 rounded-full ${count("working") ? "bg-accent" : "bg-line-2"}`}
			/>
			{count("working")} working
		</span>,
		<span key="q">{count("waiting")} waiting</span>,
		<span key="n" className={count("needs-you") ? "font-medium text-warn" : ""}>
			{count("needs-you")} need you
		</span>,
	];
	return (
		<p className="tnum flex items-center gap-3 text-sm text-fg-2">{parts}</p>
	);
}

export function Board({
	project,
	agent,
}: {
	project: string | undefined;
	agent: string | undefined;
}) {
	const { data, error } = useApi<BoardData>(
		`/api/board${query({ project })}`,
		3000,
	);
	const href = (a?: string) => boardHref({ project, agent: a });
	const [text, setText] = useState("");
	const stages = data && filterStages(data.stages, agent, text);
	return (
		<div className="flex min-h-0 flex-1 flex-col px-4 pt-6 sm:px-8 sm:pt-8 lg:h-[calc(100dvh-3.5rem)] lg:flex-none">
			<PageHeader
				title="Board"
				description="Every issue and pull request the factory touches, at the step it is at now."
			>
				{data && <Summary data={data} />}
			</PageHeader>
			{error && !data ? (
				<ErrorNote>{error}</ErrorNote>
			) : !data || !stages ? (
				<div className="grid flex-1 gap-3 pb-6 lg:grid-cols-4">
					{[0, 1, 2, 3].map((i) => (
						<Skeleton key={i} className="h-72 rounded-2xl lg:h-auto" />
					))}
				</div>
			) : (
				<>
					{/* The agents on the left, the search held to the right; on its own row when narrow. */}
					<div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-8">
						<Agents data={data} agent={agent} href={href} />
						<SearchInput
							label="Search the board"
							value={text}
							onChange={setText}
							className="lg:w-64 lg:shrink-0"
						/>
					</div>
					<div className="grid min-h-0 flex-1 gap-3 pb-6 md:grid-cols-2 lg:grid-cols-4 lg:grid-rows-[minmax(0,1fr)]">
						{stages.map((s) => (
							<Column
								key={s.id}
								stage={s.id}
								cards={s.cards}
								project={project}
								agent={agent}
							/>
						))}
					</div>
				</>
			)}
		</div>
	);
}

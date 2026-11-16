import { MessageSquare } from "lucide-react";
import { AgentTag, Elapsed } from "../../components/badges.js";
import { useAgentHue } from "../../hooks/use-agent-hue.js";
import { ago, money, runTitle, subject } from "../../lib/format.js";
import { ICONS } from "../../lib/icons.js";
import { runHref } from "../../lib/route.js";
import type { BoardCard, Stage } from "../../lib/types.js";
import { trailSteps, writtenCounts } from "./board-view.js";

const OUTPUT_NAME: Record<string, string> = {
	create_pull_request: "pull request opened",
	push_to_pull_request: "commits pushed",
	add_comment: "comment",
	request_changes: "changes requested",
	create_issue: "issue opened",
	add_labels: "labels",
	remove_labels: "labels",
	close_issue: "issue closed",
	close_pr: "pull request closed",
	merge_pull_request: "pull request merged",
};

/** What the latest run wrote, as small icons: a pull request, two comments, labels. */
function Written({ card }: { card: BoardCard }) {
	const counts = writtenCounts(card);
	if (counts.length === 0) return null;
	return (
		<span className="flex items-center gap-2">
			{counts.map(([action, n]) => {
				const Icon = ICONS[action] ?? MessageSquare;
				const name = OUTPUT_NAME[action] ?? action;
				return (
					<span
						key={action}
						title={`${n} ${name}`}
						className="inline-flex items-center gap-0.5"
					>
						<Icon className="size-3.5" aria-label={name} />
						{n > 1 && <span className="tnum text-2xs">{n}</span>}
					</span>
				);
			})}
		</span>
	);
}

/** Who worked on the subject, in order: colored marks, the latest one named. */
function Trail({ card }: { card: BoardCard }) {
	const agentHue = useAgentHue();
	const steps = trailSteps(card.trail);
	const before = steps.slice(0, -1);
	return (
		<span className="flex min-w-0 items-center gap-1.5">
			{before.length > 0 && (
				<span
					className="flex shrink-0 items-center -space-x-0.5"
					title={steps.map((t) => t.agent).join(" → ")}
				>
					{before.slice(-4).map((t) => (
						<span
							key={t.id}
							className="size-2 rounded-[3px] ring-2 ring-panel"
							style={{ background: agentHue(t.agent) }}
						/>
					))}
				</span>
			)}
			<AgentTag name={card.run.agent} className="text-fg" />
		</span>
	);
}

/** A subject at its stage: what it is, who worked on it, what it wrote. */
export function Card({
	card,
	stage,
	project,
}: {
	card: BoardCard;
	stage: Stage;
	project: string | undefined;
}) {
	const { run } = card;
	const handedOver = stage === "needs-you" && run.status !== "failed";
	return (
		<li>
			<a
				href={runHref(run.id, { project })}
				className={`group block rounded-xl border bg-panel p-3.5 text-fg no-underline shadow-1 transition-[border-color,box-shadow,transform] duration-200 ease-out-quint hover:-translate-y-px hover:shadow-2 ${stage === "working" ? "border-accent-line" : "border-line hover:border-line-2"}`}
			>
				<span className="flex items-baseline justify-between gap-3 text-xs text-fg-2">
					<span className="flex min-w-0 items-baseline gap-2">
						<span className="tnum shrink-0 font-medium">{subject(run)}</span>
						{!project && (
							<span className="truncate text-fg-3">
								{run.repository.split("/")[1]}
							</span>
						)}
					</span>
					<span className="tnum shrink-0 text-fg-3">
						{stage === "working" && run.startedAt ? (
							<Elapsed since={run.startedAt} />
						) : (
							ago(run.endedAt ?? run.queuedAt)
						)}
					</span>
				</span>
				<span className="mt-1.5 line-clamp-2 text-sm leading-5 font-medium text-pretty">
					{runTitle(run)}
				</span>
				{stage === "needs-you" && (
					<span
						className={`mt-2 line-clamp-2 text-xs ${handedOver ? "text-warn" : "text-bad"}`}
					>
						{handedOver
							? "Handed to a human"
							: (run.reason ?? "The run failed.")}
					</span>
				)}
				<span className="mt-3 flex items-center justify-between gap-3 text-xs text-fg-2">
					<Trail card={card} />
					<span className="flex shrink-0 items-center gap-2.5 text-fg-3">
						{stage === "working" ? (
							<span className="shimmer font-medium">Working</span>
						) : (
							<>
								<Written card={card} />
								{run.costUsd ? (
									<span className="tnum">{money(run.costUsd)}</span>
								) : null}
							</>
						)}
					</span>
				</span>
			</a>
		</li>
	);
}

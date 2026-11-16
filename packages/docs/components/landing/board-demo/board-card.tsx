import { Bug, CircleDot, GitPullRequestArrow, Webhook } from "lucide-react";
import { formatDuration } from "@/lib/format";
import { AgentTag } from "../agent-tag";
import { RollingNumber } from "../rolling-number";
import type { Card } from "./simulation";

const SOURCE_ICON = {
	issue: CircleDot,
	sentry: Bug,
	webhook: Webhook,
} as const;

const ago = (seconds: number) =>
	seconds < 60
		? "just now"
		: seconds < 3600
			? `${Math.floor(seconds / 60)} min ago`
			: `${Math.floor(seconds / 3600)} h ago`;

/** A card of the board: its subject, its agent, and a timer while it works or the cost once it ended. */
export function BoardCard({ card, clock }: { card: Card; clock: number }) {
	const Source = SOURCE_ICON[card.source];
	const working = card.stage === "working";
	const ended = card.stage === "done" || card.stage === "needs";
	return (
		<li
			data-flip={card.id}
			className={`relative rounded-xl border bg-of-panel p-3 shadow-of-1 ${working ? "border-of-accent-line" : "border-of-line"}`}
		>
			<span className="flex items-baseline justify-between gap-3 text-xs text-fd-muted-foreground">
				<span className="flex min-w-0 items-center gap-1.5 font-medium">
					<Source className="size-3.5 shrink-0" />
					<span className="truncate">{card.label}</span>
				</span>
				<span className="tnum shrink-0">
					{working ? (
						<RollingNumber value={formatDuration((clock - card.at) * 7 + 12)} />
					) : (
						ago((clock - card.at) * 60)
					)}
				</span>
			</span>
			<span className="mt-1.5 line-clamp-2 text-[13.5px] leading-5 font-medium text-pretty">
				{card.title}
			</span>
			{card.stage === "needs" && card.outcome.stage === "needs" && (
				<span className="mt-1.5 line-clamp-1 text-xs text-of-warn">
					{card.outcome.reason}
				</span>
			)}
			<span className="mt-2.5 flex items-center justify-between gap-3 text-xs text-fd-muted-foreground">
				<AgentTag name={card.agent} className="text-fd-foreground" />
				{working ? (
					<span className="flex items-center gap-1.5 font-medium text-fd-primary">
						<span className="of-pulse size-1.5 rounded-full bg-fd-primary" />
						Working
					</span>
				) : ended ? (
					<span className="flex items-center gap-2">
						{card.outcome.stage === "done" &&
							(card.outcome.wrote === "pr" ? (
								<GitPullRequestArrow className="size-3.5" />
							) : (
								<CircleDot className="size-3.5" />
							))}
						<span className="tnum">{card.outcome.cost}</span>
					</span>
				) : null}
			</span>
		</li>
	);
}

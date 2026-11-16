import { stageCount } from "../features/board/board-view.js";
import type { Board, Stage } from "../lib/types.js";

/** What a page has going on right now, next to its name: work in progress, work for you. */
export function LiveBadge({
	page,
	board,
	chatBusy,
}: {
	page: string;
	board: Board | undefined;
	chatBusy: boolean;
}) {
	const count = (stage: Stage) => (board ? stageCount(board, stage) : 0);
	if (page === "chat")
		return chatBusy ? (
			<span
				className="ml-auto size-1.5 rounded-full bg-accent"
				title="Answering"
				style={{ animation: "pulse-soft 1.4s ease-in-out infinite" }}
			/>
		) : null;
	if (page !== "board") return null;
	const working = count("working");
	const needs = count("needs-you");
	return (
		<span className="tnum ml-auto flex items-center gap-1.5 text-2xs font-medium">
			{working > 0 && (
				<span
					className="flex items-center gap-1 text-accent-text"
					title={`${working} working`}
				>
					<span className="size-1.5 rounded-full bg-current" />
					{working}
				</span>
			)}
			{needs > 0 && (
				<span
					className="rounded-full bg-warn-soft px-1.5 py-px text-warn"
					title={`${needs} need you`}
				>
					{needs}
				</span>
			)}
		</span>
	);
}

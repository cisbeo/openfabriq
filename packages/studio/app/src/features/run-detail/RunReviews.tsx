import { ChevronRight, CircleCheck, RotateCcw, UserRound } from "lucide-react";
import { money } from "../../lib/format.js";
import type { ReviewRound } from "../../lib/types.js";

const VERDICT: Record<
	ReviewRound["verdict"],
	{ words: string; icon: typeof CircleCheck; tone: string }
> = {
	approved: { words: "Approved", icon: CircleCheck, tone: "text-ok" },
	needs_changes: {
		words: "Needs changes",
		icon: RotateCcw,
		tone: "text-warn",
	},
	needs_human: { words: "Needs a person", icon: UserRound, tone: "text-warn" },
};

/**
 * The internal review of a run (reviewed_by): each round, its verdict and its findings, before
 * anything left the machine. Each line opens on what the reviewer found.
 */
export function RunReviews({ reviews }: { reviews: ReviewRound[] }) {
	return (
		<ul className="panel divide-y divide-line">
			{reviews.map((r) => {
				const verdict = VERDICT[r.verdict];
				const Icon = verdict.icon;
				return (
					<li key={r.round}>
						<details className="group">
							<summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm transition-colors duration-150 group-first-of-type:rounded-t-xl hover:bg-hover sm:px-5 [&::-webkit-details-marker]:hidden">
								<Icon
									className={`size-4 shrink-0 ${verdict.tone}`}
									aria-hidden
								/>
								<span className="w-16 shrink-0 text-xs text-fg-2">
									Round {r.round}
								</span>
								<span className="shrink-0 font-medium text-fg">
									{verdict.words}
									{r.risk && (
										<span className="font-normal text-fg-2">
											, risk {r.risk}
										</span>
									)}
								</span>
								<span className="min-w-0 flex-1 truncate text-xs text-fg-2">
									{r.summary}
								</span>
								<span className="tnum shrink-0 text-xs text-fg-2">
									{money(r.costUsd)}
								</span>
								<ChevronRight
									className="size-3.5 shrink-0 text-fg-3 transition-transform duration-150 group-open:rotate-90"
									aria-hidden
								/>
							</summary>
							<div className="mx-4 mt-1 mb-3 space-y-2 text-sm sm:mx-5">
								<p className="text-pretty text-fg">
									{r.summary}
									{r.reason && (
										<span className="text-fg-2"> (said by the engine)</span>
									)}
								</p>
								{r.findings.length > 0 ? (
									<ul className="space-y-1.5">
										{r.findings.map((f, i) => (
											// biome-ignore lint/suspicious/noArrayIndexKey: the reviewer's order is the identity
											<li key={i} className="text-pretty text-fg">
												{f.file && (
													<span className="font-mono text-xs text-fg-2">
														{f.file}
														{f.line ? `:${f.line}` : ""}{" "}
													</span>
												)}
												{f.problem}
												{f.suggestion && (
													<span className="text-fg-2">
														{" "}
														Expected: {f.suggestion}
													</span>
												)}
												{!f.blocking && (
													<span className="chip ml-1.5">not blocking</span>
												)}
											</li>
										))}
									</ul>
								) : (
									<p className="text-fg-2">No findings.</p>
								)}
							</div>
						</details>
					</li>
				);
			})}
		</ul>
	);
}

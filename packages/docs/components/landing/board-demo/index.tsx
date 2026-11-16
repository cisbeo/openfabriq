"use client";

import { CircleCheck, Clock3, Hand, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { useAutoplay } from "@/hooks/use-autoplay";
import { useFlipAnimation } from "@/hooks/use-flip-animation";
import { useInterval } from "@/hooks/use-interval";
import { PlayPauseButton } from "../play-pause-button";
import { RollingNumber } from "../rolling-number";
import { WindowFrame } from "../window-frame";
import { BoardCard } from "./board-card";
import { advance, initialCards, STAGES, type Stage } from "./simulation";

const COLUMNS: Record<
	Stage,
	{ title: string; Icon: typeof Clock3; tone: string }
> = {
	waiting: { title: "Waiting", Icon: Clock3, tone: "text-fd-muted-foreground" },
	working: { title: "Working", Icon: LoaderCircle, tone: "text-fd-primary" },
	needs: { title: "Needs you", Icon: Hand, tone: "text-of-warn" },
	done: { title: "Done", Icon: CircleCheck, tone: "text-of-ok" },
};

/** The studio's board, playing on its own: subjects arrive, runs start and end, cards travel. */
export function BoardDemo() {
	const { ref, paused, setPaused, running } =
		useAutoplay<HTMLDivElement>("-10% 0px");
	const [cards, setCards] = useState(initialCards);
	const [clock, setClock] = useState(0);
	const tick = useRef(0);
	const nextSubject = useRef(6);

	// The board's clock: one second of factory time per second, so working timers tick.
	useInterval(running, 1000, () => setClock((c) => c + 1));
	useInterval(running, 1700, () => {
		tick.current += 1;
		// Computed here, once per tick, not in a state updater, which Strict Mode calls twice.
		const next = advance(cards, tick.current, clock, nextSubject.current);
		nextSubject.current = next.nextSubject;
		setCards(next.cards);
	});

	// Each card starts where it was and glides to where it is now.
	const board = useFlipAnimation<HTMLDivElement>(cards);

	const count = (stage: Stage) => cards.filter((c) => c.stage === stage).length;

	return (
		<div ref={ref}>
			<WindowFrame
				title="acme/web-app › Board"
				example
				bar={
					<PlayPauseButton
						paused={paused}
						onClick={() => setPaused((p) => !p)}
						what="the board"
					/>
				}
			>
				<div className="bg-of-ground px-4 pt-5 pb-0 sm:px-6">
					<div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
						<p className="text-sm text-fd-muted-foreground">
							Every issue and pull request the factory touches, at the step it
							is at now.
						</p>
						<p className="flex items-center gap-4 text-sm" aria-hidden>
							<span className="flex items-center gap-1.5">
								<span className="size-1.5 rounded-full bg-fd-primary" />
								<RollingNumber value={String(count("working"))} /> working
							</span>
							<span className="text-fd-muted-foreground">
								<RollingNumber value={String(count("waiting"))} /> waiting
							</span>
							<span className="font-medium text-of-warn">
								<RollingNumber value={String(count("needs"))} /> need you
							</span>
						</p>
					</div>
					<div
						ref={board}
						aria-hidden
						className="relative -mx-4 mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-6 sm:-mx-6 sm:px-6 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0"
					>
						{STAGES.map((stage) => {
							const { title, Icon, tone } = COLUMNS[stage];
							return (
								<div
									key={stage}
									className="h-[21rem] w-[78%] md:h-[25.5rem] shrink-0 snap-start rounded-2xl border border-of-line bg-of-sunken/70 p-2 sm:w-[46%] md:w-auto"
								>
									<div className="flex items-center gap-2 px-2 pt-1.5 pb-3 text-sm font-medium">
										<Icon
											className={`size-4 ${tone} ${stage === "working" && running ? "animate-spin [animation-duration:2.4s]" : ""}`}
										/>
										{title}
										<span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full border border-of-line bg-of-panel px-1.5 text-xs text-fd-muted-foreground">
											<RollingNumber value={String(count(stage))} />
										</span>
									</div>
									<ul className="flex flex-col gap-2">
										{cards
											.filter((c) => c.stage === stage)
											.map((c) => (
												<BoardCard key={c.id} card={c} clock={clock} />
											))}
									</ul>
								</div>
							);
						})}
					</div>
				</div>
			</WindowFrame>
			<p className="sr-only">
				An example board: subjects arrive in Waiting, a run moves them to
				Working, and each ends in Done with what it wrote, or in Needs you with
				the reason.
			</p>
		</div>
	);
}

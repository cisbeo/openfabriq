"use client";

import {
	Bug,
	CircleDot,
	GitPullRequestArrow,
	MessageSquare,
	Tag,
	Webhook,
} from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import { useAutoplay } from "@/hooks/use-autoplay";
import { useInterval } from "@/hooks/use-interval";
import { nextTabIndex } from "@/lib/tabs";
import { type AgentName, AgentTag } from "./agent-tag";
import { PlayPauseButton } from "./play-pause-button";
import { WindowFrame } from "./window-frame";

type Icon = typeof Bug;

interface Effect {
	icon: Icon;
	source: string;
	event: string;
	detail: string;
	agent: AgentName;
	result: { icon: Icon; title: string; detail: string };
}

// What happens when each cause fires: illustrative subjects, real automations.
const EFFECTS = {
	label: {
		icon: Tag,
		source: "GitHub",
		event: "alice labeled Issue #44",
		detail: "ready-for-agent",
		agent: "implementer",
		result: {
			icon: GitPullRequestArrow,
			title: "Pull request #45 opened",
			detail:
				"Stream the export instead of loading every task. Checks passed: test, lint.",
		},
	},
	sentry: {
		icon: Bug,
		source: "Sentry",
		event: "TypeError: Cannot read properties of undefined (reading 'total')",
		detail: "checkout · production · new",
		agent: "implementer",
		result: {
			icon: GitPullRequestArrow,
			title: "Pull request #47 opened",
			detail:
				"Guard the empty cart total, with a regression test. The engine adds the Sentry link.",
		},
	},
	webhook: {
		icon: Webhook,
		source: "Webhook deploy-failed",
		event: "Deploy of 9c2e417 failed",
		detail: "signed request, through the relay",
		agent: "investigator",
		result: {
			icon: CircleDot,
			title: "Issue #48 opened",
			detail:
				"The build cannot find @acme/ui: the package was renamed in 9c2e417. A maintainer decides.",
		},
	},
	slack: {
		icon: MessageSquare,
		source: "Slack · #web-app",
		event: "@openfabriq where do we compute the trial's days left?",
		detail: "a mention in a thread",
		agent: "guide",
		result: {
			icon: MessageSquare,
			title: "Reply in the thread",
			detail:
				"In src/billing/trial.ts, daysLeft() reads the plan's end date. With the file references.",
		},
	},
} satisfies Record<string, Effect>;

export type CauseId = keyof typeof EFFECTS;

export interface Cause {
	id: CauseId;
	trigger: string;
	path: string;
	file: ReactNode;
}

/** A file you write, beside what happens when its moment comes. */
export function CauseEffect({ causes }: { causes: Cause[] }) {
	const { ref, reduced, paused, setPaused, running } =
		useAutoplay<HTMLDivElement>("-15% 0px");
	const [active, setActive] = useState(0);
	const tabs = useRef<(HTMLButtonElement | null)[]>([]);
	const id = useId();

	useInterval(running, 7000, () => setActive((a) => (a + 1) % causes.length));

	const cause = causes[active];
	if (!cause) return null;
	const effect: Effect = EFFECTS[cause.id];

	const select = (i: number) => {
		setActive(i);
		// Choosing a tab stops the rotation.
		setPaused(true);
		tabs.current[i]?.focus();
	};

	return (
		<div ref={ref}>
			<div className="flex items-center gap-2">
				<div
					role="tablist"
					aria-label="What starts the work"
					className="relative flex min-w-0 gap-1 overflow-x-auto rounded-xl border border-of-line bg-of-sunken p-1 sm:inline-flex"
					onKeyDown={(e) => {
						const next = nextTabIndex(e.key, active, causes.length);
						if (next === undefined) return;
						e.preventDefault();
						select(next);
					}}
				>
					{causes.map((c, i) => {
						const Icon = EFFECTS[c.id].icon;
						const on = i === active;
						return (
							<button
								key={c.id}
								ref={(el) => {
									tabs.current[i] = el;
								}}
								type="button"
								role="tab"
								id={`${id}-tab-${c.id}`}
								aria-selected={on}
								aria-controls={`${id}-panel`}
								tabIndex={on ? 0 : -1}
								onClick={() => select(i)}
								className={`relative flex h-9 shrink-0 items-center gap-2 overflow-hidden rounded-lg px-3.5 text-sm font-medium transition-[color,background-color,box-shadow] duration-300 ${on ? "bg-of-panel text-fd-foreground shadow-of-2" : "text-fd-muted-foreground hover:text-fd-foreground"}`}
							>
								<Icon className="size-4" aria-hidden />
								{c.trigger}
								{on && running && (
									<span
										aria-hidden
										key={active}
										className="absolute inset-x-3 bottom-0.5 h-px origin-left bg-fd-primary/60"
										style={{ animation: "of-progress 7s linear both" }}
									/>
								)}
							</button>
						);
					})}
				</div>
				{/* The rotation can be stopped (WCAG 2.2.2); choosing a tab stops it too, and the button says so. */}
				{!reduced && (
					<PlayPauseButton
						paused={paused}
						onClick={() => setPaused((p) => !p)}
						what="the rotation"
					/>
				)}
				<span className="sr-only" aria-live="polite">
					{paused && !reduced ? "The rotation is paused." : ""}
				</span>
			</div>

			<div
				id={`${id}-panel`}
				role="tabpanel"
				aria-labelledby={`${id}-tab-${cause.id}`}
				key={cause.id}
				className="mt-8 grid items-center gap-x-0 gap-y-3 lg:grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)]"
			>
				<p className="text-sm font-medium text-fd-muted-foreground lg:col-start-1 lg:row-start-1">
					You write
				</p>
				<p className="hidden text-sm font-medium text-fd-muted-foreground lg:col-start-3 lg:row-start-1 lg:block">
					What happens
				</p>
				<div className="of-enter min-w-0 lg:row-start-2">
					<WindowFrame title={cause.path}>
						<div className="of-code of-code-surface not-fumadocs-codeblock">
							{cause.file}
						</div>
					</WindowFrame>
				</div>

				<div
					aria-hidden
					className="flex items-center justify-center py-3 lg:row-start-2 lg:py-0"
				>
					<div className="relative h-8 w-px overflow-hidden bg-of-line lg:h-px lg:w-full">
						<span className="of-signal absolute inset-y-0 left-0 hidden w-1/4 bg-gradient-to-r from-transparent via-fd-primary to-transparent lg:block" />
					</div>
					<span className="mx-2 shrink-0 rounded-full border border-of-accent-line bg-of-panel px-2.5 py-1 font-mono text-[11px] text-fd-primary shadow-of-1 lg:my-2">
						engine
					</span>
					<div className="relative h-8 w-px overflow-hidden bg-of-line lg:h-px lg:w-full">
						<span className="of-signal absolute inset-y-0 left-0 hidden w-1/4 bg-gradient-to-r from-transparent via-fd-primary to-transparent [animation-delay:0.7s] lg:block" />
					</div>
				</div>

				<div className="min-w-0 lg:row-start-2">
					<p className="mb-3 text-sm font-medium text-fd-muted-foreground lg:hidden">
						What happens
					</p>
					<ol className="flex flex-col gap-2.5">
						<li className="of-enter rounded-2xl border border-of-line bg-of-panel p-4 shadow-of-2 [animation-delay:150ms]">
							<span className="flex items-center gap-2 text-xs text-fd-muted-foreground">
								<effect.icon className="size-3.5" aria-hidden />
								{effect.source}
							</span>
							<span className="mt-1.5 block text-[15px] font-medium text-pretty">
								{effect.event}
							</span>
							<span className="mt-1 block font-mono text-xs text-fd-muted-foreground">
								{effect.detail}
							</span>
						</li>
						<li className="of-enter flex items-center gap-3 rounded-2xl border border-of-accent-line bg-of-accent-soft px-4 py-3 text-sm [animation-delay:700ms]">
							<span
								className="of-pulse size-1.5 rounded-full bg-fd-primary"
								aria-hidden
							/>
							<AgentTag name={effect.agent} className="font-medium" />
							<span className="text-fd-muted-foreground">
								works in a fresh checkout, with no access to GitHub
							</span>
						</li>
						<li className="of-enter rounded-2xl border border-of-ok/30 bg-of-ok-soft p-4 [animation-delay:1400ms]">
							<span className="flex items-center gap-2 text-[15px] font-medium">
								<effect.result.icon className="size-4 text-of-ok" aria-hidden />
								{effect.result.title}
							</span>
							<span className="mt-1 block text-sm text-pretty text-fd-muted-foreground">
								{effect.result.detail}
							</span>
						</li>
					</ol>
				</div>
			</div>
		</div>
	);
}

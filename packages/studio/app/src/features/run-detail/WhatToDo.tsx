import {
	CircleAlert,
	ExternalLink,
	TriangleAlert,
	UserRound,
} from "lucide-react";
import { useState } from "react";
import type { Ask, Tab, Words } from "./what-to-do.js";

/** Words with their files and commands as code, and names set apart. */
function Line({ words }: { words: Words }) {
	return words.map((w, i) =>
		typeof w === "string" ? (
			w
		) : "code" in w ? (
			// biome-ignore lint/suspicious/noArrayIndexKey: a fixed line of words
			<code key={i}>{w.code}</code>
		) : (
			// biome-ignore lint/suspicious/noArrayIndexKey: a fixed line of words
			<span key={i} className="font-medium">
				{w.strong}
			</span>
		),
	);
}

const TONE = {
	bad: { box: "bg-bad-soft", icon: "text-bad", Icon: CircleAlert },
	warn: { box: "bg-warn-soft", icon: "text-warn", Icon: TriangleAlert },
	accent: { box: "bg-accent-soft", icon: "text-accent-text", Icon: UserRound },
};

export function WhatToDo({
	ask: a,
	link,
	linkLabel,
	tabHref,
}: {
	ask: Ask;
	link?: string;
	linkLabel: string;
	tabHref: (tab: Tab) => string;
}) {
	const tone = TONE[a.tone];
	const [wholeError, setWholeError] = useState(false);
	// A command's output can run to pages: four lines first, the rest on demand (and in the logs).
	const longError =
		!!a.error && (a.error.split("\n").length > 4 || a.error.length > 400);
	// A title alone sits on the button's middle; with more below it, everything starts at the top.
	const alone = !a.error && !a.body && a.steps.length === 0;
	return (
		<section
			aria-label="What to do"
			className={`mb-6 flex flex-col gap-4 rounded-xl px-5 py-4 sm:flex-row ${alone ? "sm:items-center" : "sm:items-start"} ${tone.box}`}
		>
			<tone.Icon
				className={`${alone ? "" : "mt-0.5 "}size-5 shrink-0 ${tone.icon}`}
				aria-hidden
			/>
			<div className="min-w-0 flex-1 text-sm text-fg [&_code]:rounded [&_code]:bg-panel/70 [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-xs">
				<h2 className="text-base font-semibold text-fg">{a.title}</h2>
				{a.error ? (
					<div className="mt-1 text-fg-2">
						<p
							className={`font-mono text-xs leading-5 break-words whitespace-pre-wrap text-fg ${longError && !wholeError ? "line-clamp-4" : ""}`}
						>
							{a.error}
						</p>
						{longError && (
							<button
								type="button"
								aria-expanded={wholeError}
								onClick={() => setWholeError((w) => !w)}
								className="mt-1.5 text-xs font-medium text-fg-2 underline-offset-2 hover:text-fg hover:underline"
							>
								{wholeError ? "Show less" : "Show the whole error"}
							</button>
						)}
					</div>
				) : (
					a.body && (
						<div className="mt-1 text-fg-2">
							<p>
								<Line words={a.body} />
							</p>
						</div>
					)
				)}
				{a.steps.length > 0 && (
					<ol className="mt-3 space-y-1.5">
						{a.steps.map((s, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of steps
							<li key={i} className="flex gap-2.5">
								<span className="tnum mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-panel text-2xs font-medium text-fg-2">
									{i + 1}
								</span>
								<span className="min-w-0 text-pretty">
									<Line words={s} />
								</span>
							</li>
						))}
					</ol>
				)}
			</div>
			<div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
				{link && (
					<a
						href={link}
						target="_blank"
						rel="noreferrer noopener"
						className="btn-ink justify-center no-underline"
					>
						{linkLabel}
						<ExternalLink className="size-3.5" aria-hidden />
					</a>
				)}
				{a.see && (
					<a href={tabHref(a.see)} className="btn justify-center no-underline">
						{a.see === "logs" ? "See logs" : "See outputs"}
					</a>
				)}
			</div>
		</section>
	);
}

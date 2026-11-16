"use client";

import { useEffect, useState } from "react";
import { useInView } from "@/hooks/use-in-view";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { WindowFrame } from "./window-frame";

// What `openfabriq plan` prints for examples/00-at-a-glance on a machine where nothing is
// applied yet, shortened where a line says how many it leaves out.
const LINES: {
	text: string;
	kind: "head" | "add" | "warn" | "more" | "sum" | "gap";
}[] = [
	{ text: "Security changes (read these first)", kind: "warn" },
	{
		text: "+ setup runs on this machine before every agent: pnpm install --frozen-lockfile",
		kind: "add",
	},
	{ text: "+ command test runs on this machine: pnpm test", kind: "add" },
	{ text: "+ maintainer alice can now start automations", kind: "add" },
	{ text: "+ agent implementer can now use edit", kind: "add" },
	{ text: "+ agent implementer can now use shell", kind: "add" },
	{
		text: "+ automation implement-ready-issues can now create_pull_request",
		kind: "add",
	},
	{ text: "20 more security changes", kind: "more" },
	{ text: "", kind: "gap" },
	{ text: "Agents", kind: "head" },
	{
		text: "+ implementer: Turns an issue or a production error into a pull request proven by the checks",
		kind: "add",
	},
	{
		text: "+ investigator: Finds why a deploy failed and writes it up as an issue, without fixing it",
		kind: "add",
	},
	{
		text: "+ reviewer: Reads the implementer's change before the pull request opens, against what the issue asks",
		kind: "add",
	},
	{ text: "", kind: "gap" },
	{ text: "Automations", kind: "head" },
	{
		text: "+ implement-ready-issues: when issue.labeled (ready-for-agent) → implementer, reviewed by reviewer, can create_pull_request, add_comment, remove_labels (ready-for-agent)",
		kind: "add",
	},
	{ text: "2 more automations", kind: "more" },
	{ text: "", kind: "gap" },
	{ text: "Factory settings", kind: "head" },
	{ text: "+ checks: test, lint", kind: "add" },
	{ text: "", kind: "gap" },
	{ text: "Labels to create on GitHub", kind: "head" },
	{ text: "+ needs-human", kind: "add" },
	{ text: "+ openfabriq:working", kind: "add" },
	{ text: "+ ready-for-agent", kind: "add" },
	{ text: "+ ready-to-merge", kind: "add" },
	{ text: "3 more labels", kind: "more" },
	{ text: "", kind: "gap" },
	{
		text: "Plan: 6 to add, 0 to change, 0 to remove, 7 labels to create.",
		kind: "sum",
	},
];

/** The plan, printed line by line the first time it comes into view. */
export function PlanTerminal() {
	const [ref, inView] = useInView<HTMLDivElement>("0px 0px -20% 0px");
	const reduced = useReducedMotion();
	const [shown, setShown] = useState(0);

	useEffect(() => {
		if (reduced || !inView || shown >= LINES.length) return;
		const id = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 350 : 70);
		return () => clearTimeout(id);
	}, [inView, shown, reduced]);
	// With less motion, the whole plan shows at once.
	const visible = reduced ? LINES.length : shown;

	return (
		<div ref={ref}>
			<WindowFrame title="Terminal — acme/web-app">
				{/* Printed line by line, so screen readers get the summary below instead. */}
				<div
					aria-hidden
					className="overflow-x-auto px-5 py-4 font-mono text-[12.5px] leading-[1.8] sm:px-6"
				>
					<p>
						<span className="text-fd-muted-foreground select-none">$ </span>
						openfabriq plan
					</p>
					<div className="min-h-[38rem] sm:min-h-[31rem]">
						{LINES.slice(0, visible).map((line, i) => (
							<p
								// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, printed in order.
								key={i}
								className={`of-enter pl-[2ch] -indent-[2ch] whitespace-pre-wrap ${
									line.kind === "head" ||
									line.kind === "warn" ||
									line.kind === "sum"
										? "font-semibold"
										: "pl-[4ch]"
								} ${line.kind === "warn" ? "text-of-warn" : ""} ${line.kind === "more" ? "text-fd-muted-foreground" : ""} ${line.kind === "gap" ? "h-[1.8em]" : ""}`}
							>
								{line.kind === "add" ? (
									<>
										<span className="text-of-ok">+</span>
										{line.text.slice(1)}
									</>
								) : line.kind === "more" ? (
									`… ${line.text}`
								) : (
									line.text
								)}
							</p>
						))}
						{visible < LINES.length && inView && (
							<span
								aria-hidden
								className="inline-block h-[1.1em] w-[0.55em] translate-y-[0.2em] animate-pulse bg-fd-foreground/70"
							/>
						)}
					</div>
				</div>
			</WindowFrame>
			<p className="sr-only">
				An example plan: security changes come first (the setup and test
				commands that run on this machine, the maintainer who can start
				automations, the tools each agent may use, what each automation may
				write), then three agents, three automations, the implementer's reviewed
				by the reviewer, the checks, and seven labels to create. Plan: 6 to add,
				0 to change, 0 to remove, 7 labels to create.
			</p>
		</div>
	);
}

import { ChevronRight, CircleCheck, CircleX } from "lucide-react";
import { duration } from "../../lib/format.js";
import type { CommandRun } from "../../lib/types.js";

const KIND: Record<CommandRun["kind"], string> = {
	check: "Check",
	command: "By the agent",
};

/**
 * What the engine ran for a run: the checks that judged its code, and the commands
 * the agent asked for. Each line opens on the end of its output.
 */
export function RunCommands({ commands }: { commands: CommandRun[] }) {
	return (
		<ul className="panel divide-y divide-line">
			{commands.map((c, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: the journal's order is the identity
				<li key={i}>
					<details className="group">
						<summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-sm transition-colors duration-150 group-first-of-type:rounded-t-xl hover:bg-hover sm:px-5 [&::-webkit-details-marker]:hidden">
							{c.ok ? (
								<CircleCheck
									className="size-4 shrink-0 text-ok"
									aria-label="passed"
								/>
							) : (
								<CircleX
									className="size-4 shrink-0 text-bad"
									aria-label="failed"
								/>
							)}
							<span className="w-24 shrink-0 text-xs text-fg-2">
								{KIND[c.kind]}
							</span>
							<span className="shrink-0 font-medium text-fg">{c.name}</span>
							<span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-3">
								{c.command}
							</span>
							<span className="tnum shrink-0 text-xs text-fg-2">
								{duration(c.durationMs)}
							</span>
							<ChevronRight
								className="size-3.5 shrink-0 text-fg-3 transition-transform duration-150 group-open:rotate-90"
								aria-hidden
							/>
						</summary>
						<pre className="mx-4 mt-2 mb-3 max-h-80 overflow-auto rounded-lg bg-sunken px-3 py-2.5 font-mono text-xs leading-5 whitespace-pre-wrap text-fg sm:mx-5">
							{c.output || "No output."}
						</pre>
					</details>
				</li>
			))}
		</ul>
	);
}

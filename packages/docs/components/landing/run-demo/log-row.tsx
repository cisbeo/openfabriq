import { Brain, ChevronRight, Play, ShieldCheck } from "lucide-react";
import { clockOf, type Entry, OUTPUTS } from "./run-script";

/** One line of the run's log, as the studio shows it. */
export function LogRow({ entry }: { entry: Entry }) {
	const time = (
		<span className="tnum w-9 shrink-0 pt-px text-xs text-fd-muted-foreground">
			{clockOf(entry.at)}
		</span>
	);
	const row =
		"of-enter flex items-start gap-3 rounded-lg px-2 py-[7px] text-sm";
	switch (entry.kind) {
		case "event":
			return (
				<li className={row}>
					{time}
					<Play className="mt-0.5 size-3.5 shrink-0 text-fd-muted-foreground" />
					<span>{entry.text}</span>
				</li>
			);
		case "thinking":
			return (
				<li className={row}>
					{time}
					<Brain className="mt-0.5 size-3.5 shrink-0 text-fd-muted-foreground" />
					<span className="flex items-center gap-1 text-fd-muted-foreground">
						<ChevronRight className="size-3.5" /> Thinking
					</span>
				</li>
			);
		case "message":
			return (
				<li className={row}>
					{time}
					<span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-fd-foreground/70" />
					<span className="text-pretty">{entry.text}</span>
				</li>
			);
		case "tool":
			return (
				<li className={row}>
					{time}
					<entry.icon className="mt-0.5 size-3.5 shrink-0 text-fd-muted-foreground" />
					<span className="flex min-w-0 flex-1 items-baseline gap-2">
						<ChevronRight className="size-3.5 shrink-0 translate-y-0.5 text-fd-muted-foreground" />
						<span className="font-medium">{entry.verb}</span>
						<code className="truncate font-mono text-[12.5px] text-fd-muted-foreground">
							{entry.arg}
						</code>
						{entry.note && (
							<span
								className={`ml-auto shrink-0 text-xs ${entry.bad ? "text-of-bad" : "text-of-ok"}`}
							>
								{entry.note}
							</span>
						)}
					</span>
				</li>
			);
		case "proposed": {
			const o = OUTPUTS[entry.output];
			if (!o) return null;
			return (
				<li
					className={`${row} my-0.5 border border-of-accent-line bg-of-accent-soft`}
				>
					{time}
					<o.icon className="mt-0.5 size-3.5 shrink-0 text-fd-primary" />
					<span className="min-w-0 truncate">
						<span className="font-medium text-fd-primary">Proposed</span>{" "}
						<span className="font-medium">{o.action}</span>{" "}
						<span className="text-fd-muted-foreground">{o.detail}</span>
					</span>
				</li>
			);
		}
		case "engine":
			return (
				<li className={row}>
					{time}
					<ShieldCheck
						className={`mt-0.5 size-3.5 shrink-0 ${entry.refused ? "text-of-bad" : "text-of-ok"}`}
					/>
					<span>
						<span className="mr-2 rounded bg-of-sunken px-1.5 py-0.5 font-mono text-[11px] text-fd-muted-foreground">
							engine
						</span>
						{entry.text}
					</span>
				</li>
			);
	}
}

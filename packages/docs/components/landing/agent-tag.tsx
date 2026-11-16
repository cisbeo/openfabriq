import { agentColor } from "@/lib/agent-color";
import { cn } from "@/lib/cn";

// The example agents' hues, as the studio spreads them for a factory of these agents.
export const AGENT_HUE = {
	implementer: 355,
	investigator: 172,
	guide: 290,
} as const;
export type AgentName = keyof typeof AGENT_HUE;

/** The studio's agent mark: a colored square and the name. */
export function AgentTag({
	name,
	className,
}: {
	name: AgentName;
	className?: string;
}) {
	return (
		<span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
			<span
				aria-hidden
				className="size-2 shrink-0 rounded-[3px]"
				style={{ background: agentColor(AGENT_HUE[name]) }}
			/>
			<span className="truncate">{name}</span>
		</span>
	);
}

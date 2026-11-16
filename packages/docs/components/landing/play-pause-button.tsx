import { Pause, Play } from "lucide-react";

/** The button in a demo's title bar: "Pause the run", or "Play the run" once paused. */
export function PlayPauseButton({
	paused,
	onClick,
	what,
}: {
	paused: boolean;
	onClick: () => void;
	/** What plays, for the label: "the run". */
	what: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground"
			aria-label={`${paused ? "Play" : "Pause"} ${what}`}
		>
			{paused ? (
				<Play className="size-3.5" aria-hidden />
			) : (
				<Pause className="size-3.5" aria-hidden />
			)}
			<span className="hidden sm:inline">{paused ? "Play" : "Pause"}</span>
		</button>
	);
}

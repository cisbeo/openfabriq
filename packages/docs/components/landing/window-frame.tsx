import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A file or terminal as a window: its path in the title bar, the content below. */
export function WindowFrame({
	title,
	children,
	className,
	bar,
	example = false,
}: {
	title: ReactNode;
	children: ReactNode;
	className?: string;
	bar?: ReactNode;
	/** Shows that what plays inside is example data, not a real repository. */
	example?: boolean;
}) {
	return (
		<div
			className={cn(
				"overflow-hidden rounded-2xl border border-of-line bg-of-panel shadow-of-3",
				className,
			)}
		>
			<div className="flex h-10 items-center gap-3 border-b border-of-line bg-of-sunken/60 px-4">
				<span aria-hidden className="flex gap-1.5">
					<span className="size-2.5 rounded-full bg-fd-foreground/12" />
					<span className="size-2.5 rounded-full bg-fd-foreground/12" />
					<span className="size-2.5 rounded-full bg-fd-foreground/12" />
				</span>
				<span className="min-w-0 flex-1 truncate font-mono text-xs text-fd-muted-foreground">
					{title}
				</span>
				{example && (
					<span className="shrink-0 rounded-full border border-of-line px-2 py-0.5 text-[11px] text-fd-muted-foreground">
						Example data
					</span>
				)}
				{bar}
			</div>
			{children}
		</div>
	);
}

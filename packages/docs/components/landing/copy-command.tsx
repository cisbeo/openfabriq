"use client";

import { Check, Copy } from "lucide-react";
import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/cn";

/** A command to paste in a terminal, with a button that copies it. */
export function CopyCommand({
	command,
	className,
	tone = "panel",
	wrap = false,
}: {
	command: string;
	className?: string;
	tone?: "panel" | "quiet";
	/** In a narrow column: the whole command shows, on two lines if it must. */
	wrap?: boolean;
}) {
	const [copied, copy] = useCopy(command);
	return (
		<div
			className={cn(
				"relative flex min-w-0 gap-2.5 rounded-xl border border-of-line pr-1.5 pl-4 font-mono text-[13px]",
				wrap ? "items-start py-1.5 leading-5" : "h-11 items-center",
				tone === "panel" ? "bg-of-panel shadow-of-1" : "bg-of-sunken",
				className,
			)}
		>
			<span
				aria-hidden
				className={cn("text-fd-muted-foreground select-none", wrap && "pt-1.5")}
			>
				$
			</span>
			{/* A long command gives up its start, never its last word: the template's name, the package. */}
			{wrap ? (
				<code className="min-w-0 flex-1 py-1.5 whitespace-pre-wrap">
					{command.slice(0, command.lastIndexOf(" ") + 1)}
					<span className="whitespace-nowrap">
						{command.slice(command.lastIndexOf(" ") + 1)}
					</span>
				</code>
			) : (
				<code className="flex min-w-0 flex-1">
					<span className="truncate whitespace-pre">
						{command.slice(0, command.lastIndexOf(" ") + 1)}
					</span>
					<span className="shrink-0 whitespace-pre">
						{command.slice(command.lastIndexOf(" ") + 1)}
					</span>
				</code>
			)}
			<button
				type="button"
				onClick={copy}
				className="flex size-8 shrink-0 items-center justify-center rounded-lg text-fd-muted-foreground transition-colors duration-200 hover:bg-fd-accent hover:text-fd-foreground"
				aria-label={copied ? "Copied" : `Copy ${command}`}
			>
				{copied ? (
					<Check className="of-digit size-4 text-of-ok" aria-hidden />
				) : (
					<Copy className="size-4" aria-hidden />
				)}
			</button>
			<span className="sr-only" aria-live="polite">
				{copied ? "Copied to the clipboard" : ""}
			</span>
		</div>
	);
}

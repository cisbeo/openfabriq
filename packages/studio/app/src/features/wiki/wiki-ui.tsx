import type { ReactNode } from "react";

/** Links outside the page's prose look like the prose's. */
export const PROSE_LINK =
	"text-accent-text underline decoration-accent-line hover:decoration-accent-text";

/** A file name, a command or a key, in a line of text. */
export function InlineCode({ children }: { children: ReactNode }) {
	return (
		<code className="rounded-md bg-sunken px-1.5 py-0.5 font-mono text-xs text-fg ring-1 ring-line">
			{children}
		</code>
	);
}

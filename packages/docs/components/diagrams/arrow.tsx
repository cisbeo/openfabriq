import { Fragment, type ReactNode } from "react";

/** A vertical connector, with the words on it when there are some. */
function Arrow({ label }: { label?: string }) {
	return (
		<div className="flex flex-col items-center py-1.5 text-fd-muted-foreground">
			<span className="h-4 w-px bg-current opacity-40" />
			{label && (
				<span className="my-0.5 rounded-full border bg-fd-background px-3 py-1 text-center text-xs leading-snug">
					{label}
				</span>
			)}
			<span className="h-4 w-px bg-current opacity-40" />
			<svg
				viewBox="0 0 10 6"
				className="size-2.5 fill-current opacity-60"
				aria-hidden
			>
				<path d="M0 0h10L5 6z" />
			</svg>
		</div>
	);
}

/**
 * Boxes top to bottom with an arrow between each: a string among the steps is the label of the
 * arrow that comes next.
 */
export function withArrows<T>(
	steps: (T | string)[],
	box: (step: T) => ReactNode,
): ReactNode[] {
	const out: ReactNode[] = [];
	let label: string | undefined;
	steps.forEach((step, i) => {
		if (typeof step === "string") {
			label = step;
			return;
		}
		// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list.
		if (out.length) out.push(<Arrow key={`a${i}`} label={label} />);
		label = undefined;
		// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list.
		out.push(<Fragment key={i}>{box(step)}</Fragment>);
	});
	return out;
}

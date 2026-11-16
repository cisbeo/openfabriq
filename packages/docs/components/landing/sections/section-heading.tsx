import type { ReactNode } from "react";

/** A section's title and the paragraph under it. */
export function SectionHeading({
	id,
	children,
	lead,
}: {
	id: string;
	children: ReactNode;
	lead: ReactNode;
}) {
	return (
		<div className="max-w-2xl">
			<h2
				id={id}
				className="text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-[2.6rem] sm:leading-[1.08]"
			>
				{children}
			</h2>
			<p className="mt-5 text-lg leading-relaxed text-pretty text-fd-muted-foreground">
				{lead}
			</p>
		</div>
	);
}

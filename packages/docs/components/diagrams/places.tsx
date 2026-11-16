import type { ReactNode } from "react";
import { withArrows } from "./arrow";
import { Icon, type IconName } from "./icon";

// Where each piece lives, top to bottom.

export interface Place {
	icon: IconName;
	title: string;
	/** A short tag above the title, such as "your laptop or a server". */
	where?: string;
	items: string[];
	accent?: boolean;
}
type PlaceStep = Place | string;

/** Wide boxes top to bottom, each arrow with what crosses it: readable at any width. */
export function Places({
	steps,
	caption,
}: {
	steps: PlaceStep[];
	caption?: ReactNode;
}) {
	const boxes = withArrows(steps, (step) => (
		<div
			className={`grid w-full gap-4 rounded-xl border p-5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-6 ${step.accent ? "border-fd-primary/50 bg-fd-primary/5" : "bg-fd-card"}`}
		>
			<div className="flex items-start gap-3">
				<Icon
					name={step.icon}
					className={`mt-0.5 size-5 ${step.accent ? "text-fd-primary" : "text-fd-muted-foreground"}`}
				/>
				<div>
					<div className="font-semibold leading-snug">{step.title}</div>
					{step.where && (
						<div className="mt-0.5 text-[13px] text-fd-muted-foreground">
							{step.where}
						</div>
					)}
				</div>
			</div>
			<ul className="flex flex-col gap-1.5 text-sm leading-relaxed text-fd-muted-foreground">
				{step.items.map((item) => (
					<li key={item} className="flex gap-2.5">
						<span
							aria-hidden
							className="mt-[0.6em] size-1 shrink-0 rounded-full bg-current opacity-60"
						/>
						<span>{item}</span>
					</li>
				))}
			</ul>
		</div>
	));
	return (
		<figure className="not-prose my-8">
			<div className="flex flex-col items-center">{boxes}</div>
			{caption && (
				<figcaption className="mt-4 text-center text-sm text-fd-muted-foreground">
					{caption}
				</figcaption>
			)}
		</figure>
	);
}

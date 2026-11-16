import { type ReactNode, useState } from "react";
import { axisTicks, percent } from "./overview-figures.js";

// The overview's building blocks: its cards and figures, and its two charts.

/** A bar cut in parts, in proportion: what a whole is made of. */
export function Shares({
	label,
	parts,
}: {
	label: string;
	parts: { key: string; value: number; color: string }[];
}) {
	const total = parts.reduce((sum, p) => sum + p.value, 0);
	return (
		<div
			role="img"
			aria-label={label}
			className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-sunken"
		>
			{parts
				.filter((p) => p.value > 0)
				.map((p) => (
					<span
						key={p.key}
						className="h-full min-w-1"
						style={{ width: percent(p.value, total), background: p.color }}
					/>
				))}
		</div>
	);
}

const dayLabel = (day: string, long = false) =>
	new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", {
		...(long ? { weekday: "short" } : {}),
		day: "numeric",
		month: "short",
	});

/** One series over time: columns from one baseline, a tooltip per column. */
export function PerDay({
	days,
	format,
	color,
	unit,
	minStep,
	partColor,
}: {
	days: {
		day: string;
		value: number;
		runs?: number;
		/** The column cut in parts, bottom first: what the day's value is made of. */
		parts?: { key: string; value: number }[];
	}[];
	format: (value: number) => string;
	color: string;
	/** The color of each part, when the days have parts. */
	partColor?: (key: string) => string;
	/** A word after the value in the tooltip, when `format` does not say it. */
	unit?: string;
	/** The smallest step between two lines of the axis, in the series' own unit. */
	minStep?: number;
}) {
	const [hover, setHover] = useState<number>();
	const max = Math.max(...days.map((d) => d.value), 0);
	const ticks = axisTicks(max, minStep);
	const top = ticks.at(-1) ?? 1;
	const shown = hover === undefined ? undefined : days[hover];
	return (
		<div className="flex flex-1 flex-col">
			<div className="relative min-h-40 flex-1">
				{ticks.map((t) => (
					<div
						key={t}
						className="absolute inset-x-0 flex items-center gap-2"
						style={{ top: `${(1 - t / top) * 100}%` }}
					>
						<span className="tnum w-12 -translate-y-1/2 text-right text-2xs text-fg-3">
							{format(t)}
						</span>
						<span
							className={`flex-1 -translate-y-1/2 ${t === 0 ? "h-px bg-line-2" : "border-t border-dashed border-line"}`}
						/>
					</div>
				))}
				<div
					className="absolute inset-y-0 right-0 left-14 flex items-end"
					onPointerLeave={() => setHover(undefined)}
				>
					{days.map((d, i) => (
						<button
							type="button"
							key={d.day}
							aria-label={`${dayLabel(d.day, true)}: ${format(d.value)}${unit ? ` ${unit}` : ""}`}
							onPointerEnter={() => setHover(i)}
							onFocus={() => setHover(i)}
							onBlur={() => setHover(undefined)}
							className="flex h-full min-w-0 flex-1 items-end justify-center px-px focus-visible:outline-offset-0"
						>
							<span
								className={`flex w-full max-w-5 flex-col-reverse overflow-hidden rounded-t-[3px] transition-opacity duration-150 ${hover !== undefined && hover !== i ? "opacity-40" : ""}`}
								style={{
									height:
										d.value > 0 ? `max(${(d.value / top) * 100}%, 3px)` : "1px",
									background:
										d.value > 0 && !d.parts?.length ? color : "var(--line-2)",
								}}
							>
								{d.parts?.map((part) => (
									<span
										key={part.key}
										className="block w-full"
										style={{
											flexGrow: part.value,
											background: partColor?.(part.key) ?? color,
										}}
									/>
								))}
							</span>
						</button>
					))}
				</div>
				{shown && hover !== undefined && (
					<div
						className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-panel px-3 py-2 shadow-pop"
						style={{
							left: `calc(56px + (100% - 56px) * ${(hover + 0.5) / days.length})`,
						}}
					>
						<div className="tnum text-sm font-semibold whitespace-nowrap text-fg">
							{format(shown.value)}
							{unit && ` ${unit}`}
						</div>
						<div className="tnum text-xs whitespace-nowrap text-fg-2">
							{dayLabel(shown.day, true)}
							{shown.runs !== undefined &&
								` · ${shown.runs} ${shown.runs === 1 ? "run" : "runs"}`}
						</div>
						{shown.parts?.map((part) => (
							<div
								key={part.key}
								className="tnum mt-1 flex items-center gap-1.5 text-xs whitespace-nowrap text-fg-2"
							>
								<span
									className="size-2 rounded-full"
									style={{ background: partColor?.(part.key) ?? color }}
									aria-hidden
								/>
								{part.key} {format(part.value)}
							</div>
						))}
					</div>
				)}
			</div>
			{days.length > 0 && (
				<div
					className={`tnum mt-2 ml-14 flex text-2xs text-fg-3 ${days.length === 1 ? "justify-center" : "justify-between"}`}
				>
					<span>{dayLabel(days[0]?.day ?? "")}</span>
					{days.length > 1 && <span>{dayLabel(days.at(-1)?.day ?? "")}</span>}
				</div>
			)}
		</div>
	);
}

/** A card of the overview: its name, then what it shows. */
export function Card({
	title,
	action,
	className = "",
	children,
}: {
	title: string;
	/** A control at the right of the title, such as a filter. */
	action?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<section
			className={`panel relative flex min-w-0 flex-col p-4 sm:p-5 ${className}`}
		>
			<div className="flex items-center justify-between gap-3">
				<h4 className="min-h-6 text-[13px] leading-6 font-medium text-pretty text-fg">
					{title}
				</h4>
				{action}
			</div>
			{children}
		</section>
	);
}

/** A card's figure, and a line under it that says what it is made of. */
export function Figure({
	value,
	children,
}: {
	value: ReactNode;
	children?: ReactNode;
}) {
	return (
		<>
			<div className="tnum mt-1 text-2xl font-semibold tracking-[-0.025em] text-fg">
				{value}
			</div>
			{children && (
				<div className="tnum mt-1 text-xs text-pretty text-fg-2">
					{children}
				</div>
			)}
		</>
	);
}

export const none = <span className="text-fg-3">—</span>;

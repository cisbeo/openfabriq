import { cn } from "@/lib/cn";

/** A number that changes in place: each digit that changes arrives from below. */
export function RollingNumber({
	value,
	className,
}: {
	value: string;
	className?: string;
}) {
	return (
		<span className={cn("tnum inline-flex", className)}>
			<span className="sr-only">{value}</span>
			{[...value.replaceAll(" ", "\u00a0")].map((char, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: a digit is keyed by its place and value, so only changed digits animate.
					key={`${i}-${char}`}
					aria-hidden
					className="of-digit"
				>
					{char}
				</span>
			))}
		</span>
	);
}

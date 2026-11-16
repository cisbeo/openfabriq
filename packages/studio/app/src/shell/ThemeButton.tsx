import { Monitor, Moon, Sun } from "lucide-react";
import type { Theme } from "../hooks/use-theme.js";

/** The theme now, as an icon: a click moves to the next one. */
export function ThemeButton({
	theme,
	next,
}: {
	theme: Theme;
	next: () => void;
}) {
	const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
	return (
		<button
			type="button"
			onClick={next}
			title={`Theme: ${theme}. Click to change.`}
			aria-label={`Theme: ${theme}`}
			className="inline-flex size-8 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-hover hover:text-fg"
		>
			<Icon className="size-4" aria-hidden />
		</button>
	);
}

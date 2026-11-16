/** The class names that apply, joined: `cn("a", on && "b", className)`. */
export const cn = (...names: (string | false | undefined)[]) =>
	names.filter(Boolean).join(" ");

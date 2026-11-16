// `ignore_paths`: `*` matches within one folder, `**` across folders.

function globToRegExp(pattern: string): RegExp {
	let source = "";
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i] ?? "";
		if (char === "*" && pattern[i + 1] === "*") {
			// `**/` also matches no folder at all: `docs/**/a.md` matches `docs/a.md`.
			if (pattern[i + 2] === "/") {
				source += "(?:.*/)?";
				i += 2;
			} else {
				source += ".*";
				i += 1;
			}
		} else if (char === "*") source += "[^/]*";
		else if (char === "?") source += "[^/]";
		else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${source}$`);
}

export function matchesGlob(path: string, pattern: string): boolean {
	return globToRegExp(pattern).test(path);
}

/** True when every changed file matches one of the patterns. No file known: nothing is ignored. */
export function onlyIgnoredPaths(
	files: readonly string[],
	patterns: readonly string[],
): boolean {
	const globs = patterns.map(globToRegExp);
	return files.length > 0 && files.every((f) => globs.some((g) => g.test(f)));
}

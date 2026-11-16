import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { type Answer, textAnswer } from "./answer.js";

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".json": "application/json",
	".webmanifest": "application/manifest+json",
};

/**
 * A file of the app built by Vite, never one outside its folder. Its page goes only to who is
 * signed in: the others get `signedOut`, which says how to get in. Throws a URIError on a
 * malformed path.
 */
export function staticFile(
	root: string,
	pathname: string,
	signedOut: Answer | undefined,
): Answer {
	const file = resolve(
		root,
		`.${decodeURIComponent(pathname === "/" ? "/index.html" : pathname)}`,
	);
	if (
		!file.startsWith(root + sep) ||
		!existsSync(file) ||
		!statSync(file).isFile()
	)
		return existsSync(join(root, "index.html"))
			? textAnswer(404, "text/plain", "Not found.")
			: textAnswer(
					503,
					"text/plain",
					'The studio is not built. Run "pnpm build".',
				);
	// The scripts and styles hold no data; the page itself says how to get in.
	if (file === join(root, "index.html") && signedOut) return signedOut;
	return textAnswer(
		200,
		TYPES[extname(file)] ?? "application/octet-stream",
		readFileSync(file),
	);
}

// A folder of files as a tree a reader opens and closes, from the files' paths alone.

/** "agents/implementer/agent.md" → ["agents", "agents/implementer"]: the folders that hold a path. */
export const foldersOf = (path: string) =>
	path
		.split("/")
		.slice(0, -1)
		.map((_, i, parts) => parts.slice(0, i + 1).join("/"));

/** Every folder that holds one of the paths, once. */
export const foldersIn = (paths: string[]) => [
	...new Set(paths.flatMap(foldersOf)),
];

export interface TreeRow {
	/** The last part of the path, with a "/" after a folder's. */
	name: string;
	path: string;
	depth: number;
	folder: boolean;
}

/** The tree as rows: each folder once, before its files. */
export function rowsOf(paths: string[]): TreeRow[] {
	const rows: TreeRow[] = [];
	for (const path of paths) {
		const parts = path.split("/");
		parts.forEach((name, depth) => {
			const at = parts.slice(0, depth + 1).join("/");
			const folder = depth < parts.length - 1;
			if (!rows.some((r) => r.path === at))
				rows.push({
					name: folder ? `${name}/` : name,
					path: at,
					depth,
					folder,
				});
		});
	}
	return rows;
}

/** The rows a reader sees: none inside a closed folder. */
export const visibleRows = (paths: string[], closed: ReadonlySet<string>) =>
	rowsOf(paths).filter(
		(row) => !foldersOf(row.path).some((folder) => closed.has(folder)),
	);

/** One branch open at a time: every folder closed but the ones that lead to `path`. */
export const closedAllBut = (paths: string[], path: string) =>
	new Set(
		foldersIn(paths).filter((f) => f !== path && !path.startsWith(`${f}/`)),
	);

/** Closing a folder closes the folders it holds too. */
export const closeFolder = (
	paths: string[],
	closed: ReadonlySet<string>,
	folder: string,
) =>
	new Set([
		...closed,
		...foldersIn(paths).filter(
			(f) => f === folder || f.startsWith(`${folder}/`),
		),
	]);

/** The file a folder leads to: one it holds directly, or the file of its only subfolder. */
export function fileOf(paths: string[], folder: string): string | undefined {
	const own = paths.find((p) => foldersOf(p).at(-1) === folder);
	if (own) return own;
	const subfolders = foldersIn(paths).filter(
		(f) => foldersOf(f).at(-1) === folder,
	);
	return subfolders.length === 1 && subfolders[0]
		? fileOf(paths, subfolders[0])
		: undefined;
}

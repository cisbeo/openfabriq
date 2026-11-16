import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { FactoryFiles } from "@openfabriq/core";

/** The `openfabriq/` folder of a repository, or the folder itself when it holds factory.yaml. */
export function factoryFolder(dir: string): string {
	const nested = join(dir, "openfabriq");
	return existsSync(join(dir, "factory.yaml")) || !existsSync(nested)
		? dir
		: nested;
}

export function readFactoryFolder(dir: string): FactoryFiles {
	const files: FactoryFiles = {};
	for (const entry of readdirSync(dir, {
		recursive: true,
		withFileTypes: true,
	})) {
		if (!entry.isFile()) continue;
		const path = join(entry.parentPath, entry.name);
		files[relative(dir, path).split(sep).join("/")] = readFileSync(
			path,
			"utf8",
		);
	}
	return files;
}

/**
 * A new file, then a rename: a reader, or a stop in the middle, never sees half of it. The temp
 * name is unique, so two writers of the same file never share one.
 */
export function writeFileAtomic(
	path: string,
	data: string | Buffer,
	mode?: number,
): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
	writeFileSync(tmp, data, mode === undefined ? {} : { mode });
	renameSync(tmp, path);
}

/** The JSON in a file, or undefined when there is no file. */
export function readJsonIfExists<T>(path: string): T | undefined {
	return existsSync(path)
		? (JSON.parse(readFileSync(path, "utf8")) as T)
		: undefined;
}

/** The records of a JSON Lines file; a line still being written, or broken, is skipped. */
export function jsonLines<T>(text: string): T[] {
	return text.split("\n").flatMap((line) => {
		if (!line.trim()) return [];
		try {
			return [JSON.parse(line) as T];
		} catch {
			return [];
		}
	});
}

export const errorText = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

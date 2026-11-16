import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { loadFactory } from "../src/factory/load.js";
import type { Factory, FactoryFiles } from "../src/factory/types.js";

export const ROOT = join(import.meta.dirname, "../../..");

/** Reads an `openfabriq/` folder into the path → content map that `loadFactory` takes. */
export function readFolder(dir: string): FactoryFiles {
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

/** Loads a factory that must be valid. */
export function load(files: FactoryFiles): Factory {
	const { factory, problems } = loadFactory(files);
	if (!factory) throw new Error(JSON.stringify(problems));
	return factory;
}

export const example = (name: string) =>
	readFolder(join(ROOT, "examples", name, "openfabriq"));

/** A full factory frozen for tests: the 02-sdlc example as it was, so the template can grow. */
export const sdlcFiles = () =>
	readFolder(join(ROOT, "fixtures/valid/sdlc/openfabriq"));

/** For a plan about the factory alone: no file outside what it describes changed. */
export const NO_FILES = { before: {}, after: {} };

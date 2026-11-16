import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Factory } from "@openfabriq/core";
import { loadFactory } from "@openfabriq/core";
import { factoryFolder, readFactoryFolder } from "@openfabriq/runner";
import type { CommandResult } from "../result.js";

export const validateCommand = (dir = "."): CommandResult =>
	checkFactoryFolder(dir).result;

/** The validation, with the files read and the factory loaded, so plan and apply read them once. */
export type Checked =
	| {
			ok: true;
			result: CommandResult;
			folder: string;
			files: Record<string, string>;
			factory: Factory;
	  }
	| { ok: false; result: CommandResult; folder: string };

export function checkFactoryFolder(dir: string): Checked {
	const folder = factoryFolder(dir);
	// Without factory.yaml, the folder is no factory: never read it (a whole repository would be).
	if (!existsSync(join(folder, "factory.yaml")))
		return {
			ok: false,
			folder,
			result: {
				code: 1,
				output: `No factory in ${resolve(dir)}: no factory.yaml there, nor in an openfabriq/ folder. Run "openfabriq init", or pass the folder that holds factory.yaml.`,
			},
		};
	const files = readFactoryFolder(folder);
	const { factory, problems } = loadFactory(files);
	const lines = problems.map(
		(p) => `${p.level === "error" ? "✗" : "!"} ${p.file}: ${p.message}`,
	);
	const errors = problems.filter((p) => p.level === "error").length;
	if (!factory)
		lines.push("", `${errors} error${errors === 1 ? "" : "s"} in ${folder}`);
	else {
		const count = (n: number, word: string) =>
			`${n} ${word}${n === 1 ? "" : "s"}`;
		lines.push(
			`✓ ${folder} is valid: ${count(Object.keys(factory.agents).length, "agent")}, ${count(Object.keys(factory.automations).length, "automation")}`,
		);
	}
	const result = { code: factory ? 0 : 1, output: lines.join("\n") };
	return factory
		? { ok: true, result, folder, files, factory }
		: { ok: false, result, folder };
}

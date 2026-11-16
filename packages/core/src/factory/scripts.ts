import type { FactoryFiles, Problem } from "./types.js";

// The first word of a command, when it names a file of openfabriq/scripts/.
const SCRIPT_WORD = /^scripts\/[^\s;&|<>()]+/;
const TESTS = /^scripts\/test\//;
const LANGUAGES = /\.(sh|mjs)$/;

/** The script of openfabriq/scripts/ a command runs: its first word, when it starts with scripts/. */
export function scriptOf(command: string): string | undefined {
	return SCRIPT_WORD.exec(command)?.[0];
}

/** A script the engine may run: a file of openfabriq/scripts/, outside its tests. */
export const isScript = (path: string) =>
	path.startsWith("scripts/") && !TESTS.test(path);

/**
 * What is wrong with the scripts: those that commands and setup run (reported on factory.yaml,
 * `where` names the line), and the files of scripts/ in another language.
 */
export function scriptProblems(
	lines: [where: string, command: string][],
	files: FactoryFiles,
): Omit<Problem, "level">[] {
	const problems: Omit<Problem, "level">[] = [];
	for (const [where, command] of lines) {
		const script = scriptOf(command);
		if (!script) continue;
		const say = (message: string) =>
			problems.push({
				file: "factory.yaml",
				message: `${where}: ${script} ${message}`,
			});
		const text = files[script];
		if (script.split("/").includes("..")) say("leaves openfabriq/scripts/");
		else if (TESTS.test(script))
			say("is a test of the scripts; a command cannot run it");
		else if (text === undefined)
			say(
				`is not in openfabriq/scripts/. To run a file of the repository, write ./${script}`,
			);
		else if (!LANGUAGES.test(script))
			say("is not a script: a script is a .sh or .mjs file");
		else if (!text.startsWith("#!"))
			say("must start with a line like #!/bin/sh, which says what runs it");
	}
	for (const path of Object.keys(files).sort())
		if (isScript(path) && !LANGUAGES.test(path))
			problems.push({
				file: path,
				message: "a script is a .sh or .mjs file; scripts/test/ takes any file",
			});
	return problems;
}

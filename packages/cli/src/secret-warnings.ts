import { type Factory, secretNames } from "@openfabriq/core";
import {
	factorySecretsPath,
	looseFactorySecrets,
	readFactorySecretsFile,
	secretValues,
} from "@openfabriq/runner";

/**
 * What is wrong with each project's secrets: a file others can read, lines that do not read, a
 * value both in the environment and in the file, a secret set nowhere. A missing secret does not
 * stop a run: the command or MCP server that needs it fails on its own. Values come from the
 * engine's environment, then the project's file. "start" logs them, "doctor" lists them.
 */
export function secretWarnings(
	factories: Pick<Factory, "repository" | "secrets" | "mcp">[],
	env: NodeJS.ProcessEnv = process.env,
): string[] {
	return factories.flatMap((f) => {
		const names = secretNames(f as Factory);
		if (!names.length) return [];
		const path = factorySecretsPath(f.repository);
		const file = readFactorySecretsFile(f.repository);
		const values = secretValues(f.repository, names, env);
		const missing = names.filter((n) => !(n in values));
		// Names only, never a value or the text of a line.
		const shadowed = names.filter(
			(n) => Object.hasOwn(env, n) && Object.hasOwn(file.values, n),
		);
		const lines: string[] = [];
		if (looseFactorySecrets(f.repository))
			lines.push(
				`${f.repository}: ${path} can be read by other users of this machine; run chmod 600 on it`,
			);
		if (file.bad.length)
			lines.push(
				`${f.repository}: ${path} has lines that do not read (line ${file.bad.join(", ")}); write them NAME='value'`,
			);
		if (shadowed.length)
			lines.push(
				`${f.repository}: ${shadowed.join(", ")} set both in this engine's environment and in ${path}; the environment's value is used`,
			);
		if (missing.length)
			lines.push(
				`${f.repository}: ${missing.join(", ")} not set on this machine; the commands or MCP servers that need ${missing.length > 1 ? "them" : "it"} will fail. Set ${missing.length > 1 ? "each" : "it"} with "openfabriq secret set ${missing[0]}"`,
			);
		return lines;
	});
}

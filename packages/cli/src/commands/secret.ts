// openfabriq secret set <NAME> [--project owner/repo]: keeps the value of a secret a
// factory declares, on this machine only, in ~/.openfabriq/secrets/<owner>/<repo>.env.

import { isEngineVariable, sameName, secretNames } from "@openfabriq/core";
import {
	envLine,
	factorySecretsPath,
	listProjects,
	writeFactorySecret,
} from "@openfabriq/runner";
import { findAppliedProjects } from "../projects.js";
import type { CommandResult } from "../result.js";

const USAGE = "Usage: openfabriq secret set <NAME> [--project owner/repo]";

export async function secretCommand(
	command: {
		action: string | undefined;
		name: string | undefined;
		/** What was typed after the name: a value given as an argument. */
		extra?: string[];
		project?: string;
	},
	io: {
		ask: (question: string, options: { secret?: boolean }) => Promise<string>;
		env?: NodeJS.ProcessEnv;
	},
): Promise<CommandResult> {
	const { action, name, extra = [], project } = command;
	const { ask, env = process.env } = io;
	if (action !== "set" || !name) return { code: 1, output: USAGE };
	if (extra.length)
		return {
			code: 1,
			output: `Nothing saved. Never give a value as an argument: it is now in your shell history. Change that secret where it comes from, then run "openfabriq secret set ${name}" and type it when asked.`,
		};
	if (isEngineVariable(name))
		return {
			code: 1,
			output: `${name} belongs to the engine; a factory never receives it.`,
		};

	// Only a name an applied factory declares, and only for a project applied here: the path of the
	// file is built from that project, never from what was typed.
	const applied = listProjects().map((p) => p.repository);
	if (project && !applied.some((repo) => sameName(repo, project)))
		return {
			code: 1,
			output: `${project} is not applied on this machine. Run "openfabriq apply" in its repository first.`,
		};
	const found = findAppliedProjects(project, (factory) =>
		secretNames(factory).includes(name),
	).map((p) => p.repository);
	const [repository] = found;
	if (!repository)
		return {
			code: 1,
			output: `No applied factory${project ? ` of ${project}` : ""} names ${name} in secrets or in an MCP server. Declare it in factory.yaml, then run "openfabriq apply".`,
		};
	if (found.length > 1)
		return {
			code: 1,
			output: `${name} is a secret of ${found.join(" and ")}: pass --project owner/repo.`,
		};

	const value = (
		await ask(
			`Value of ${name} for ${repository} (a test value, never a production one): `,
			{ secret: true },
		)
	).trim();
	if (!value) return { code: 1, output: "No value given: nothing saved." };
	if (!envLine(name, value))
		return {
			code: 1,
			output: `This value holds both ' and ", or a line break: it cannot be written to the file. Put ${name} in the engine's environment instead.`,
		};
	writeFactorySecret(repository, name, value);
	const shadowed =
		env[name] !== undefined
			? `\nNote: the engine's environment also has ${name}, and it wins over the file.`
			: "";
	return {
		code: 0,
		output: `Saved ${name} for ${repository} in ${factorySecretsPath(repository)}, readable by you only. The next run uses it.${shadowed}`,
	};
}

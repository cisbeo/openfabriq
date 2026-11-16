// openfabriq run <automation> [--issue n | --pr n] [--project owner/repo]: asks the
// engine of "openfabriq start" for a manual run. It runs nothing itself.

import { randomUUID } from "node:crypto";
import { manualEvent, requestRun } from "@openfabriq/runner";
import type { CommandLine } from "../args.js";
import { findAppliedProjects, gitConfig } from "../projects.js";
import type { CommandResult } from "../result.js";

export async function runCommand({
	positionals,
	values,
}: CommandLine): Promise<CommandResult> {
	return runManually(
		positionals[1],
		{
			...(values.issue ? { issue: values.issue } : {}),
			...(values.pr ? { pr: values.pr } : {}),
			...(values.project ? { project: values.project } : {}),
		},
		await gitUserName(),
	);
}

export function runManually(
	name: string | undefined,
	options: { issue?: string; pr?: string; project?: string },
	by: string,
	now = new Date(),
): CommandResult {
	if (!name)
		return {
			code: 1,
			output:
				"Usage: openfabriq run <automation> [--issue n | --pr n] [--project owner/repo]",
		};
	if (options.issue && options.pr)
		return { code: 1, output: "Pass --issue or --pr, not both." };
	const asked = options.issue ?? options.pr;
	const number = asked === undefined ? undefined : Number(asked);
	if (number !== undefined && !(Number.isInteger(number) && number > 0))
		return {
			code: 1,
			output: `"${asked}" is not an issue or pull request number.`,
		};

	const found = findAppliedProjects(
		options.project,
		// Own keys only: "constructor" is no automation.
		(factory) =>
			Object.hasOwn(factory.automations, name)
				? factory.automations[name]
				: undefined,
	);
	const [first] = found;
	if (!first)
		return {
			code: 1,
			output: `No automation "${name}" in the applied factories${options.project ? ` of ${options.project}` : ""}. Check its folder name in openfabriq/automations/, and that it is applied.`,
		};
	if (found.length > 1)
		return {
			code: 1,
			output: `"${name}" is in ${found.map((f) => f.repository).join(" and ")}: pass --project owner/repo.`,
		};

	const request = {
		id: randomUUID(),
		automation: name,
		...(number !== undefined ? { number } : {}),
		isPullRequest: options.pr !== undefined,
		by,
		at: now.toISOString(),
	};
	const event = manualEvent(first.found, request);
	if (typeof event === "string") return { code: 1, output: event };
	requestRun(first.repository, request);
	const on =
		number === undefined ? "" : `, ${options.pr ? "PR" : "issue"} #${number}`;
	return {
		code: 0,
		output: `Asked: a manual run of ${name} on ${first.repository}${on}. "openfabriq start" takes it within a minute; follow it in the studio, under Runs.`,
	};
}

/** Who asks for the run: the git user of this machine. */
const gitUserName = () =>
	gitConfig("user.name").then(
		(name) => name || "someone",
		() => "someone",
	);

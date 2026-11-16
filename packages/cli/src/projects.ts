import { type Factory, sameName } from "@openfabriq/core";
import { exec, listProjects, readAppliedFactory } from "@openfabriq/runner";

// What the commands read of this machine: the projects applied here, and git's own settings.

/**
 * The projects applied on this machine (only the one `project` names, whatever its case, when
 * given) whose applied factory has what `pick` looks for, with what it found.
 */
export function findAppliedProjects<T>(
	project: string | undefined,
	pick: (factory: Factory) => T | undefined | false,
): { repository: string; found: T }[] {
	return namedProjects(
		listProjects().map((p) => p.repository),
		project,
	).flatMap((repository) => {
		const factory = readAppliedFactory(repository);
		const found = factory && pick(factory);
		return found ? [{ repository, found }] : [];
	});
}

/**
 * The repositories `project` names (all of them without it): the one written the same way when
 * there is one, else those that match whatever their case. On a case-sensitive disk, applying
 * acme/app then Acme/App leaves both, and `--project Acme/App` must still pick one.
 */
export function namedProjects(
	repositories: string[],
	project: string | undefined,
): string[] {
	if (!project) return repositories;
	if (repositories.includes(project)) return [project];
	return repositories.filter((repository) => sameName(repository, project));
}

/** A value of git's config on this machine; rejects when it is not set. */
export const gitConfig = (key: string) =>
	exec("git", ["config", "--get", key]).then((value) => value.trim());

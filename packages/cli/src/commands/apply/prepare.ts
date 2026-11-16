import {
	type Factory,
	formatPlan,
	loadFactory,
	type Plan,
	planChanges,
	sameName,
} from "@openfabriq/core";
import {
	type GitHub,
	type LocalGit,
	listProjects,
	readAppliedFactory,
	readAppliedFiles,
} from "@openfabriq/runner";
import type { CommandResult } from "../../result.js";
import { checkFactoryFolder } from "../validate.js";
import { sharedWithOthers } from "./conflicts.js";

export interface ApplyDeps {
	github: Pick<GitHub, "defaultBranch" | "labels" | "createLabel" | "clone">;
	git: LocalGit;
	confirm: (question: string) => Promise<boolean>;
	/** Shows the plan before the confirmation is asked. */
	print: (text: string) => void;
}

export type Prepared =
	| { ok: false; result: CommandResult }
	| {
			ok: true;
			factory: Factory;
			/** The factory applied before, when there was one that loads. */
			applied: Factory | undefined;
			files: Record<string, string>;
			plan: Plan;
			text: string;
	  };

/**
 * The warnings over the plan, in this order: integrations shared with another project, an origin
 * that is not the factory's repository, a branch that is not the default one, uncommitted
 * changes, then an applied factory this version no longer reads.
 */
export function planWarnings(facts: {
	shared: string[];
	elsewhere: string | undefined;
	branch: string | undefined;
	defaultBranch: string;
	dirty: boolean;
	appliedUnreadable: boolean;
}): string[] {
	const warnings = [...facts.shared];
	if (facts.elsewhere) warnings.push(`! ${facts.elsewhere}`);
	if (facts.branch && facts.branch !== facts.defaultBranch)
		warnings.push(
			`! You are on branch "${facts.branch}", not ${facts.defaultBranch}: apply what is merged.`,
		);
	if (facts.dirty) warnings.push("! openfabriq/ has uncommitted changes.");
	if (facts.appliedUnreadable)
		warnings.push(
			"! The factory applied now does not load with this version of openfabriq (its format changed): everything shows as new.",
		);
	return warnings;
}

/** Validates the factory, refuses what cannot be applied, and plans the rest under its warnings. */
export async function preparePlan(
	dir: string,
	deps: ApplyDeps,
	repository?: string,
	yes = false,
): Promise<Prepared> {
	const checked = checkFactoryFolder(dir);
	if (!checked.ok) return { ok: false, result: checked.result };
	const { folder, files, factory } = checked;
	// A server applies each repository it cloned: one repository's factory never replaces another's.
	if (repository && !sameName(repository, factory.repository))
		return {
			ok: false,
			result: {
				code: 1,
				output: `✗ factory.yaml names ${factory.repository}, not ${repository}, the repository it was taken from. Nothing was applied.`,
			},
		};

	const shared = sharedWithOthers(
		factory,
		listProjects().flatMap((p) => readAppliedFactory(p.repository) ?? []),
	);
	if (shared.refused.length)
		return {
			ok: false,
			result: {
				code: 1,
				output: `${shared.refused.join("\n")}\nNothing was applied.`,
			},
		};

	const appliedFiles = readAppliedFiles(factory.repository);
	const applied = appliedFiles ? loadFactory(appliedFiles).factory : undefined;
	// Without --project, the checkout's origin tells where factory.yaml comes from.
	const origin = repository ? undefined : await deps.git.origin(folder);
	const elsewhere =
		origin && !sameName(origin, factory.repository)
			? `factory.yaml names ${factory.repository}, but this checkout's origin is ${origin}.`
			: undefined;
	if (elsewhere && yes)
		return {
			ok: false,
			result: {
				code: 1,
				output: `✗ ${elsewhere} Nothing was applied: give the repository with --project to apply it anyway.`,
			},
		};
	let read: [string[], string, string | undefined, boolean];
	try {
		read = await Promise.all([
			deps.github.labels(factory.repository),
			deps.github.defaultBranch(factory.repository),
			deps.git.branch(folder),
			deps.git.dirty(folder),
		]);
	} catch (error) {
		// The examples' acme/web-app, or a typo: gh's own words do not say what to change.
		if (!/HTTP 404/.test(String(error))) throw error;
		return {
			ok: false,
			result: {
				code: 1,
				output: `✗ gh finds no repository ${factory.repository}: set repository in factory.yaml to yours (owner/name), one the account of "gh auth status" can read.`,
			},
		};
	}
	const [labels, defaultBranch, branch, dirty] = read;
	const warnings = planWarnings({
		shared: shared.warnings,
		elsewhere,
		branch,
		defaultBranch,
		dirty,
		appliedUnreadable: Boolean(appliedFiles && !applied),
	});
	const plan = planChanges(applied, factory, labels, {
		before: appliedFiles,
		after: files,
	});
	const text = [
		...(warnings.length ? [warnings.join("\n")] : []),
		formatPlan(plan),
	].join("\n\n");
	return { ok: true, factory, applied, files, plan, text };
}

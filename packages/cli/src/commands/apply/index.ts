import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Factory, isEmptyPlan, type Plan } from "@openfabriq/core";
import { closeHome, projectDir, writeApplied } from "@openfabriq/runner";
import type { CommandResult } from "../../result.js";
import { type ApplyDeps, type Prepared, preparePlan } from "./prepare.js";

// openfabriq plan | apply: what the factory would change, then, after a yes, the labels on
// GitHub, the engine's clone and the applied copy of the factory. "start" applies through here too.

export type { ApplyDeps } from "./prepare.js";

export async function planCommand(
	dir: string,
	deps: ApplyDeps,
): Promise<CommandResult> {
	const prepared = await preparePlan(dir, deps);
	return prepared.ok ? { code: 0, output: prepared.text } : prepared.result;
}

const cloneOf = (repo: string) => join(projectDir(repo), "repo");

/** Applied already: the same files, and the engine's clone is there. */
const upToDate = (p: { factory: Factory; plan: Plan }) =>
	isEmptyPlan(p.plan) && existsSync(cloneOf(p.factory.repository));

/** Slack, Linear, Sentry and the webhooks: what a running engine connects only when it starts. */
const integrationsChanged = (before: Factory | undefined, after: Factory) =>
	JSON.stringify([
		before?.slack,
		before?.linear,
		before?.sentry,
		before?.webhooks,
	]) !==
	JSON.stringify([after.slack, after.linear, after.sentry, after.webhooks]);

export async function applyCommand(
	dir: string,
	deps: ApplyDeps,
	yes = false,
	repository?: string,
): Promise<CommandResult> {
	const prepared = await preparePlan(dir, deps, repository, yes);
	if (!prepared.ok) return prepared.result;
	if (upToDate(prepared))
		return { code: 0, output: `${prepared.text}\n\nNothing to apply.` };
	return applyPlan(prepared, deps, yes);
}

/**
 * `start` run in a repository with a factory applies what changed first, once the person says
 * yes, so that a new factory needs one command. Returns what to print, nothing when
 * the factory is applied already; a no, or an invalid factory, leaves the one applied before.
 */
export async function applyBeforeStart(
	dir: string,
	deps: ApplyDeps,
): Promise<string | undefined> {
	if (
		!existsSync(join(dir, "openfabriq")) &&
		!existsSync(join(dir, "factory.yaml"))
	)
		return undefined;
	const prepared = await preparePlan(dir, deps);
	if (!prepared.ok)
		return `${prepared.result.output}\nNot applied: "start" runs the factory applied before, if any.`;
	if (upToDate(prepared)) return undefined;
	const result = await applyPlan(prepared, deps, false);
	return result.code === 0
		? `Applied to ${prepared.factory.repository}.`
		: `Not applied: "start" runs the factory applied before, if any.`;
}

async function applyPlan(
	prepared: Extract<Prepared, { ok: true }>,
	deps: ApplyDeps,
	yes: boolean,
): Promise<CommandResult> {
	const { factory, files, plan, text } = prepared;
	const repo = factory.repository;
	const cloneDir = cloneOf(repo);

	deps.print(`${text}\n`);
	if (!yes && !(await deps.confirm(`Apply this plan to ${repo}?`)))
		return { code: 1, output: "Cancelled. Nothing was applied." };

	for (const label of plan.labels) await deps.github.createLabel(repo, label);
	closeHome();
	if (!existsSync(cloneDir)) {
		mkdirSync(projectDir(repo), { recursive: true });
		await deps.github.clone(repo, cloneDir);
	}
	writeApplied(repo, files);
	return {
		code: 0,
		output: `Applied. ${repo} runs this factory as soon as "openfabriq start" is running.${
			integrationsChanged(prepared.applied, factory)
				? '\nIts integrations changed: if "openfabriq start" is running, restart it (Ctrl-C, then "openfabriq start"), since it connects them when it starts.'
				: ""
		}`,
	};
}

// openfabriq update: installs the latest openfabriq from npm, or says how when it came another way.
// `start` uses the same check to say when a new version is out.

import { existsSync, readFileSync } from "node:fs";
import { errorText, exec } from "@openfabriq/runner";
import { PACKAGE_JSON, PACKAGED, SOURCES } from "../paths.js";
import type { CommandResult } from "../result.js";

/** How this openfabriq was installed: from npm, with Homebrew, linked from a clone of its sources, or in its Docker image. */
export type InstallKind = "npm" | "homebrew" | "sources" | "docker";

export interface UpdateDeps {
	kind: InstallKind;
	current: string;
	latest: () => Promise<string | undefined>;
	install: () => Promise<string>;
	/** The clone this openfabriq runs from, for kind "sources". */
	sources: string;
}

const REGISTRY = "https://registry.npmjs.org/openfabriq/latest";

/** The version npm calls latest, or undefined when the registry does not answer within 3 s. */
export async function latestVersion(
	get: typeof fetch = fetch,
): Promise<string | undefined> {
	try {
		const res = await get(REGISTRY, { signal: AbortSignal.timeout(3000) });
		if (!res.ok) return undefined;
		const { version } = (await res.json()) as { version?: unknown };
		return typeof version === "string" ? version : undefined;
	} catch {
		return undefined;
	}
}

const numbers = (version: string) =>
	/^(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number);

/** Whether `latest` comes after `current`; a pre-release or an odd version is never newer. */
export function isNewer(latest: string, current: string): boolean {
	const [a, b] = [numbers(latest), numbers(current)];
	if (!a || !b) return false;
	for (let i = 0; i < 3; i++)
		if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
	return false;
}

function installKind(): InstallKind {
	if (existsSync("/.dockerenv")) return "docker";
	if (!PACKAGED) return "sources";
	// The formula installs the npm package in Homebrew's Cellar.
	return PACKAGE_JSON.includes("/Cellar/") ? "homebrew" : "npm";
}

export function defaultUpdateDeps(): UpdateDeps {
	const kind = installKind();
	return {
		kind,
		current: (
			JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as { version: string }
		).version,
		latest: () => latestVersion(),
		install: () =>
			kind === "homebrew"
				? exec("brew", ["upgrade", "openfabriq"])
				: exec("npm", ["install", "--global", "openfabriq@latest"]),
		sources: SOURCES,
	};
}

export async function updateCommand(
	deps: UpdateDeps = defaultUpdateDeps(),
): Promise<CommandResult> {
	if (deps.kind === "sources")
		return {
			code: 0,
			output: `This openfabriq runs from its sources in ${deps.sources}: run git pull && pnpm install && pnpm build there.`,
		};
	if (deps.kind === "docker")
		return {
			code: 0,
			output:
				"In Docker, update the image: git pull && docker compose up -d --build, in openfabriq's folder.",
		};
	// Homebrew knows its own latest version, which can come a little after npm's.
	if (deps.kind === "homebrew") {
		await deps.install();
		return {
			code: 0,
			output:
				'Homebrew upgraded openfabriq, or it was already the latest. If "openfabriq start" runs, restart it.',
		};
	}
	const latest = await deps.latest();
	if (!latest)
		return {
			code: 1,
			output:
				"npm gave no version of openfabriq (offline, or not published yet): try again later, or run npm install --global openfabriq@latest.",
		};
	if (!isNewer(latest, deps.current))
		return {
			code: 0,
			output: `openfabriq ${deps.current} is the latest version.`,
		};
	try {
		await deps.install();
	} catch (error) {
		return {
			code: 1,
			output: `npm could not install openfabriq ${latest}: ${errorText(error)}\nWith a Node that needs it, run: sudo npm install --global openfabriq@latest`,
		};
	}
	return {
		code: 0,
		output: `openfabriq ${latest} installed (was ${deps.current}). If "openfabriq start" runs, restart it.`,
	};
}

/** For start: one line when npm has a newer openfabriq than this one, installed from npm or Homebrew. */
export async function updateNotice(
	deps: UpdateDeps = defaultUpdateDeps(),
): Promise<string | undefined> {
	if (deps.kind !== "npm" && deps.kind !== "homebrew") return undefined;
	const latest = await deps.latest();
	return latest && isNewer(latest, deps.current)
		? `openfabriq ${latest} is out (this is ${deps.current}): run openfabriq update`
		: undefined;
}

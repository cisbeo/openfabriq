import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Keys of the repo's .claude/settings.json that run a command for Claude Code itself.
const HELPERS = [
	"apiKeyHelper",
	"awsCredentialExport",
	"awsAuthRefresh",
	"gcpAuthRefresh",
	"otelHeadersHelper",
	"proxyAuthHelper",
];

// Keys of the repo's .claude/settings.json that bring code or reach the factory does not declare:
// plugins, where they come from, and directories outside the worktree.
const WIDENING: [string, (s: Record<string, unknown>) => unknown][] = [
	["enabledPlugins", (s) => s.enabledPlugins],
	["extraKnownMarketplaces", (s) => s.extraKnownMarketplaces],
	["additionalMarketplaces", (s) => s.additionalMarketplaces],
	[
		"permissions.additionalDirectories",
		(s) =>
			(s.permissions as Record<string, unknown> | undefined)
				?.additionalDirectories,
	],
];

// Where Claude Code finds the project's skills and commands: their allowed-tools pre-approve tools.
const GRANTING = [".claude/skills", ".claude/commands"];
const frontmatter = (text: string) =>
	text.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";

/** Why a project skill or command of the branch is refused: it grants tools, or the engine cannot read it. */
function toolGrant(cwd: string): string | undefined {
	for (const folder of GRANTING) {
		let entries: Dirent[];
		try {
			entries = readdirSync(join(cwd, folder), {
				recursive: true,
				withFileTypes: true,
			});
		} catch {
			continue;
		}
		for (const entry of entries) {
			const path = relative(cwd, join(entry.parentPath, entry.name))
				.split(sep)
				.join("/");
			// A link could point where this check does not look.
			if (entry.isSymbolicLink())
				return `the repository's ${path} is a link, which the engine does not follow to check it`;
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
			const text = readFileSync(join(cwd, path), "utf8");
			if (/^["']?allowed-tools["']?\s*:/m.test(frontmatter(text)))
				return `the repository's ${path} grants tools with allowed-tools: the factory lists the tools an agent may use`;
		}
	}
	return undefined;
}

/**
 * The repo's .claude/settings.json comes from the pull request's branch. Its `env` would set
 * Claude Code's own variables (ANTHROPIC_BASE_URL sends the login elsewhere): each of its keys
 * gets the engine's value back, or an empty one. A credential helper refuses the run, and so do
 * plugins, marketplaces and directories it adds, a project skill or command that grants itself
 * tools, and a file the engine cannot check: Claude Code might still load it. With `limitedWeb`, an
 * agent whose web tool keeps to its sites, so does a rule that lets WebFetch or WebSearch reach more.
 */
export function repoSettings(
	cwd: string,
	env: Record<string, string>,
	limitedWeb = false,
): { env: Record<string, string>; refused?: string } {
	const granted = toolGrant(cwd);
	if (granted) return { env: {}, refused: granted };
	let text: string;
	try {
		text = readFileSync(join(cwd, ".claude/settings.json"), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { env: {} };
		return {
			env: {},
			refused:
				"the repository's .claude/settings.json cannot be read, so the engine cannot check it",
		};
	}
	let settings: Record<string, unknown>;
	try {
		// Claude Code drops a leading byte-order mark before parsing: so does the check.
		const parsed: unknown = JSON.parse(text.replace(/^﻿/, ""));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error("not an object");
		settings = parsed as Record<string, unknown>;
	} catch {
		return {
			env: {},
			refused:
				"the repository's .claude/settings.json is not a JSON object the engine can check",
		};
	}
	const keys = Object.keys((settings.env as object | undefined) ?? {});
	const helper = HELPERS.find((h) => settings[h] !== undefined);
	const widening = WIDENING.find(
		([, read]) => read(settings) !== undefined,
	)?.[0];
	const allow = (settings.permissions as { allow?: unknown } | undefined)
		?.allow;
	const webRule = limitedWeb
		? (Array.isArray(allow) ? allow : []).find(
				(rule) => typeof rule === "string" && /^Web(Fetch|Search)\b/.test(rule),
			)
		: undefined;
	const refused = helper
		? `the repository's .claude/settings.json sets ${helper}, a command the engine does not run`
		: widening
			? `the repository's .claude/settings.json sets ${widening}, which a branch does not choose for the factory's agents`
			: webRule
				? `the repository's .claude/settings.json allows ${webRule}, which a branch does not choose: the factory's network lists the sites agents reach`
				: undefined;
	return {
		env: Object.fromEntries(keys.map((k) => [k, env[k] ?? ""])),
		...(refused ? { refused } : {}),
	};
}

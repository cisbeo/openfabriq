import { existsSync, realpathSync } from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { type Network, networkText, reaches } from "@openfabriq/core";

const FILE_TOOLS: Record<string, "read" | "write"> = {
	Read: "read",
	Grep: "read",
	Glob: "read",
	Edit: "write",
	Write: "write",
	NotebookEdit: "write",
};

/** The real path, links followed, of a file that may not exist yet. */
export function realPath(path: string): string {
	let dir = resolve(path);
	let rest = "";
	while (!existsSync(dir) && dirname(dir) !== dir) {
		rest = rest ? join(basename(dir), rest) : basename(dir);
		dir = dirname(dir);
	}
	return join(realpathSync(dir), rest);
}

export const within = (path: string, root: string) => {
	const r = relative(root, path);
	return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};

/**
 * A PreToolUse callback for WebFetch: the agent's sites only. Its permission rules let the listed
 * sites through, but Claude Code also lets documentation sites through on its own (measured with
 * docs.stripe.com): this refuses them, and tells the agent where a maintainer adds a site.
 */
export function webInNetwork(
	network: Network,
	refused?: (sites: string[]) => void,
): HookCallback {
	return async (input) => {
		if (
			input.hook_event_name !== "PreToolUse" ||
			input.tool_name !== "WebFetch"
		)
			return {};
		const url = (input.tool_input as { url?: unknown } | undefined)?.url;
		let host: string | undefined;
		try {
			host = new URL(String(url)).hostname;
		} catch {}
		if (host && reaches(network, host)) return {};
		if (host) refused?.([host]);
		return {
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: host
					? `${host} is not in this agent's network (${networkText(network)}): a maintainer adds it to network, in the agent's agent.md or in factory.yaml. Say in your report that you needed it.`
					: `${String(url)} is not a web address the engine can check against this agent's network.`,
			},
		};
	};
}

/**
 * A PreToolUse callback: the file tools read inside `cwd` and `readAlso`, write inside `cwd`, and
 * never write Claude Code's settings files. It runs whatever the Claude Code version.
 */
export function insideOnly(cwd: string, readAlso: string[] = []): HookCallback {
	const roots = [cwd, ...readAlso].map(realPath);
	return async (input) => {
		if (input.hook_event_name !== "PreToolUse") return {};
		const kind = FILE_TOOLS[input.tool_name];
		if (!kind) return {};
		const args = (input.tool_input ?? {}) as Record<string, unknown>;
		// A Glob pattern is a path too: "../*" or "/etc/*" look outside.
		const paths = [
			args.file_path,
			args.notebook_path,
			args.path,
			input.tool_name === "Glob" ? args.pattern : undefined,
		].filter((p): p is string => typeof p === "string");
		const allowed = kind === "read" ? roots : roots.slice(0, 1);
		const refused = paths.find((p) => {
			const target = realPath(resolve(input.cwd || cwd, p));
			return (
				!allowed.some((root) => within(target, root)) ||
				(kind === "write" &&
					// Case-insensitive: APFS and NTFS take .CLAUDE/Settings.JSON for the same file.
					/\/\.claude\/settings[^/]*\.json$/i.test(target))
			);
		});
		if (refused === undefined) return {};
		return {
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: `${refused}: outside the working directory, or a Claude Code settings file`,
			},
		};
	};
}

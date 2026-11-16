import { exec } from "../exec.js";

/** The user's local checkout, only read to warn before apply. */
export interface LocalGit {
	branch(dir: string): Promise<string | undefined>;
	dirty(dir: string): Promise<boolean>;
	/** owner/name of the checkout's origin; undefined when it has none. */
	origin(dir: string): Promise<string | undefined>;
}

/** owner/name in a remote's URL: its last two path parts, whatever the form (https, ssh, scp-like). */
export function repositoryOfRemote(url: string): string | undefined {
	const parts = url
		.trim()
		.replace(/\.git$/, "")
		.split(/[/:]/)
		.filter(Boolean);
	return parts.length >= 2 ? parts.slice(-2).join("/") : undefined;
}

export const localGit: LocalGit = {
	async branch(dir) {
		const branch = await exec("git", [
			"-C",
			dir,
			"rev-parse",
			"--abbrev-ref",
			"HEAD",
		]).then(
			(out) => out.trim(),
			() => undefined,
		);
		if (branch !== "HEAD") return branch;
		// Detached: name it after the origin branch at the same commit, if there is one.
		const remotes = await exec("git", [
			"-C",
			dir,
			"branch",
			"-r",
			"--points-at",
			"HEAD",
		]).catch(() => "");
		const names = remotes
			.split("\n")
			.map((l) => l.trim().replace(/^origin\//, ""));
		return names.find((n) => n && !n.startsWith("HEAD")) ?? "a detached commit";
	},
	async origin(dir) {
		return exec("git", ["-C", dir, "remote", "get-url", "origin"]).then(
			repositoryOfRemote,
			() => undefined,
		);
	},
	async dirty(dir) {
		return exec("git", ["-C", dir, "status", "--porcelain", "--", "."]).then(
			(out) => out.trim() !== "",
			() => false,
		);
	},
};

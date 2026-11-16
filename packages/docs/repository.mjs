import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The `repository` of the workspace's root package.json, found up from where the build runs. */
function rootRepository() {
	for (let dir = process.cwd(); ; dir = dirname(dir)) {
		const file = join(dir, "package.json");
		const manifest = existsSync(file) && JSON.parse(readFileSync(file, "utf8"));
		if (manifest?.repository)
			return manifest.repository.replace(/^github:/, "");
		if (dirname(dir) === dir)
			throw new Error("No package.json with a repository above this folder.");
	}
}

/**
 * The project's GitHub repository, as owner/name: OPENFABRIQ_REPOSITORY for a fork, or else the
 * root package.json's `repository`, the one place it is written.
 */
export const REPOSITORY = process.env.OPENFABRIQ_REPOSITORY ?? rootRepository();

export const GITHUB_URL = `https://github.com/${REPOSITORY}`;

/**
 * For the pages: a link written `repo:tree/main/examples/02-sdlc` goes to that path of the
 * repository, and `%GITHUB_URL%` or `%GITHUB_OWNER%` in code is the address or its owner.
 */
export function remarkRepository() {
	const owner = REPOSITORY.split("/")[0];
	const walk = (node) => {
		if (typeof node.url === "string" && node.url.startsWith("repo:"))
			node.url = `${GITHUB_URL}/${node.url.slice("repo:".length)}`.replace(
				/\/$/,
				"",
			);
		if (typeof node.value === "string")
			node.value = node.value
				.replaceAll("%GITHUB_URL%", GITHUB_URL)
				.replaceAll("%GITHUB_OWNER%", owner);
		for (const child of node.children ?? []) walk(child);
	};
	return walk;
}

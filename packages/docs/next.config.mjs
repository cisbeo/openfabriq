import { createMDX } from "fumadocs-mdx/next";
import { GITHUB_URL } from "./repository.mjs";

const withMDX = createMDX();

/** The site is plain files: `next build` writes them to `out/`, to be served from anywhere. */
export default withMDX({
	reactStrictMode: true,
	output: "export",
	trailingSlash: true,
	images: { unoptimized: true },
	// The project's address, the same in the pages and in the browser.
	env: { OPENFABRIQ_GITHUB_URL: GITHUB_URL },
	// Next writes AGENTS.md and CLAUDE.md beside the app on first start; the repository has its own.
	agentRules: false,
});

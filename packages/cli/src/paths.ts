import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Resolved from packages/cli/dist/ in this repository, or from dist/ of the npm package, which
// carries examples/ and relay/ beside it.
/** Installed from npm (or in the Docker image), not linked from a clone of the sources. */
export const PACKAGED = existsSync(here("../examples"));
/** package.json of this openfabriq: the npm package's, or packages/cli's in the sources. */
export const PACKAGE_JSON = here("../package.json");
/** The clone of the sources, when this openfabriq runs from one. */
export const SOURCES = here("../../..").replace(/\/$/, "");

/** The CLI, the Claude Code plugin and the examples, for init. */
export const PATHS = {
	cli: here("./index.js"),
	plugin: here("../plugin"),
	examples: here(PACKAGED ? "../examples" : "../../../examples"),
};

/** The relay's sources, which connect relay deploys with wrangler. */
export const RELAY_DIR = here(PACKAGED ? "../relay" : "../../relay");

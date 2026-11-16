/** The Node that package.json's engines asks for: an older one starts, then fails later on what 24 brings. */
export const MINIMUM_NODE = 24;

/** Why this Node cannot run openfabriq, or undefined when it can. */
export function nodeTooOld(version: string): string | undefined {
	if (Number(version.split(".")[0]) >= MINIMUM_NODE) return undefined;
	return `openfabriq needs Node ${MINIMUM_NODE} or later, and this is Node ${version}. Install it from https://nodejs.org, or with nvm: nvm install ${MINIMUM_NODE}`;
}

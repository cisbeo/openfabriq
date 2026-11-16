import type { Factory, FactoryFiles } from "./types.js";

/**
 * What an agent and the engine's commands can reach: any site, or these sites, where the word
 * `packages` stands for the package registries. An empty list reaches nothing (`none`).
 */
export type Network = "any" | string[];

export const PACKAGES = "packages";

/** Without `network`, agents and commands reach the package registries only. */
export const DEFAULT_NETWORK: Network = [PACKAGES];

/** The package registries, and GitHub to read code and releases: what `packages` reaches. */
export const PACKAGE_SITES = [
	// npm, pnpm and Yarn
	"registry.npmjs.org",
	"registry.yarnpkg.com",
	"repo.yarnpkg.com",
	// Python
	"pypi.org",
	"files.pythonhosted.org",
	// Rust
	"crates.io",
	"index.crates.io",
	"static.crates.io",
	// Ruby
	"rubygems.org",
	"index.rubygems.org",
	// PHP
	"packagist.org",
	"repo.packagist.org",
	// Go
	"proxy.golang.org",
	"sum.golang.org",
	// Java and .NET
	"repo.maven.apache.org",
	"repo1.maven.org",
	"api.nuget.org",
	// GitHub, which package managers download from; the engine gives commands no GitHub token.
	"github.com",
	"api.github.com",
	"codeload.github.com",
	"raw.githubusercontent.com",
	"objects.githubusercontent.com",
];

const SITE =
	/^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** A domain, or `*.` and a domain for its subdomains: what a list of `network` names. */
export const isSite = (entry: string) => SITE.test(entry);

/** The network an agent's shell, web tool, commands and checks have. */
export function agentNetwork(
	factory: { network?: Network | undefined },
	agent: { network?: Network | undefined },
): Network {
	return agent.network ?? factory.network ?? DEFAULT_NETWORK;
}

/** setup installs the dependencies before the agent: it always reaches the package registries. */
export function setupNetwork(factory: {
	network?: Network | undefined;
}): Network {
	const network = factory.network ?? DEFAULT_NETWORK;
	return network === "any" ? network : unique([PACKAGES, ...network]);
}

/** The sites themselves, with `packages` spelled out. */
export function networkSites(network: Network): Network {
	return network === "any"
		? network
		: unique(
				network.flatMap((entry) =>
					entry === PACKAGES ? PACKAGE_SITES : entry,
				),
			);
}

/** Whether `network` reaches `host`: a site of its list, or a subdomain of a `*.` one. */
export function reaches(network: Network, host: string): boolean {
	const sites = networkSites(network);
	if (sites === "any") return true;
	const h = host.toLowerCase().replace(/\.$/, "");
	return sites.some((site) => {
		const s = site.toLowerCase();
		return s.startsWith("*.") ? h.endsWith(s.slice(1)) : h === s;
	});
}

// A domain has a dot: `https://framerusercontent\.com` in a regular expression names none.
const URL_HOST = /\bhttps?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;
// Names of this machine, reached as localhost, and names reserved for examples (RFC 2606): never sites to add.
const NOT_A_SITE =
	/^(localhost|127\.0\.0\.1|example\.(com|org|net))$|\.(localhost|test|local|ddev\.site|lndo\.site|invalid|example|example\.(com|org|net))$/i;

/**
 * The sites the factory's own files name (setup, commands, env, its scripts) that its network does
 * not reach, each with where it is named: for doctor. A command runs with an agent's network, so a
 * site any agent or the factory reaches counts as reached. A script's tests call fakes: left out.
 */
export function unlistedSites(
	factory: Factory,
	files: FactoryFiles,
): Record<string, string[]> {
	const networks = [
		factory.network ?? DEFAULT_NETWORK,
		...Object.values(factory.agents).map((a) => agentNetwork(factory, a)),
	];
	const places: [string, string, Network[]][] = [
		...(factory.setup ?? []).map((line): [string, string, Network[]] => [
			"setup",
			line,
			[setupNetwork(factory)],
		]),
		...Object.entries(factory.commands ?? {}).map(
			([name, line]): [string, string, Network[]] => [
				`command ${name}`,
				line,
				networks,
			],
		),
		...Object.entries(factory.env ?? {}).map(
			([name, value]): [string, string, Network[]] => [
				`env ${name}`,
				value,
				networks,
			],
		),
		...Object.entries(files)
			.filter(
				([path]) =>
					path.startsWith("scripts/") && !path.startsWith("scripts/test/"),
			)
			.map(([path, text]): [string, string, Network[]] => [
				path,
				text,
				networks,
			]),
	];
	const unlisted: Record<string, string[]> = {};
	for (const [where, text, reachedBy] of places)
		for (const [, found] of text.matchAll(URL_HOST)) {
			const host = (found ?? "").toLowerCase().replace(/\.$/, "");
			if (NOT_A_SITE.test(host) || reachedBy.some((n) => reaches(n, host)))
				continue;
			const list = unlisted[host] ?? [];
			if (!list.includes(where)) unlisted[host] = [...list, where];
		}
	return unlisted;
}

/** `none`, `any site`, or the list as written. */
export function networkText(network: Network): string {
	if (network === "any") return "any site";
	return network.length ? network.join(", ") : "none";
}

/** Whether `network` already reaches all an entry of a list reaches: `packages`, a site, or `*.` and a domain. */
function covers(network: Network, entry: string): boolean {
	if (entry === PACKAGES)
		return PACKAGE_SITES.every((s) => reaches(network, s));
	if (!entry.startsWith("*.")) return reaches(network, entry);
	const sites = networkSites(network);
	// Only a wildcard covers a wildcard: the same one, or one of a parent domain.
	return (
		sites === "any" ||
		sites.some(
			(s) => s.startsWith("*.") && (s === entry || entry.endsWith(s.slice(1))),
		)
	);
}

/** What `after` reaches that `before` did not, in words: `any site`, or the new entries. */
export function gainedSites(before: Network, after: Network): string[] {
	if (before === "any") return [];
	if (after === "any") return ["any site"];
	return after.filter((entry) => !covers(before, entry));
}

const unique = (items: string[]) => [...new Set(items)];

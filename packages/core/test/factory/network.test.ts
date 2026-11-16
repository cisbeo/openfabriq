import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFactory } from "../../src/factory/load.js";
import {
	agentNetwork,
	gainedSites,
	networkSites,
	networkText,
	PACKAGE_SITES,
	reaches,
	setupNetwork,
	unlistedSites,
} from "../../src/factory/network.js";
import type { FactoryFiles } from "../../src/factory/types.js";
import { load, ROOT } from "../helpers.js";

const FACTORY = "name: F\nrepository: acme/app\nmaintainers: [alice]\n";

const files = (
	factoryYaml: string,
	agentHeader: string,
	tools = "[read]",
): FactoryFiles => ({
	"factory.yaml": `${FACTORY}${factoryYaml}`,
	"agents/worker/agent.md": `---\ndescription: Does things\ntools: ${tools}\n${agentHeader}\n---\nDo things.\n`,
	"automations/run/automation.md":
		"---\nwhen: issue.opened\nagent: worker\n---\nGo.\n",
});

const messages = (f: FactoryFiles) =>
	loadFactory(f).problems.map((p) => `${p.file}: ${p.message}`);

describe("the network key", () => {
	it("reads none, packages, any and a list of sites, in factory.yaml and agent.md", () => {
		const read = (yaml: string, header = "") =>
			loadFactory(files(yaml, header)).factory;
		expect(read("")?.network).toBeUndefined();
		expect(read("network: none\n")?.network).toEqual([]);
		expect(read("network: packages\n")?.network).toEqual(["packages"]);
		expect(read("network: any\n")?.network).toBe("any");
		expect(
			read("network: [packages, docs.stripe.com, '*.sentry.io']\n")?.network,
		).toEqual(["packages", "docs.stripe.com", "*.sentry.io"]);
		expect(read("", "network: none")?.agents.worker?.network).toEqual([]);
		expect(read("", "")?.agents.worker?.network).toBeUndefined();
	});

	it("refuses another word, a site that is not a domain, and an empty list", () => {
		expect(messages(files("network: everything\n", ""))).toEqual([
			'factory.yaml: network: "everything" is not none, packages or any; a list names sites, like [packages, docs.stripe.com]',
		]);
		expect(
			messages(files("network: [packages, https://x.com, '*', '*.com']\n", "")),
		).toEqual([
			'factory.yaml: network: "https://x.com" is not a site: write a domain, like docs.stripe.com or *.sentry.io',
			'factory.yaml: network: "*" is not a site: write a domain, like docs.stripe.com or *.sentry.io',
			'factory.yaml: network: "*.com" is not a site: write a domain, like docs.stripe.com or *.sentry.io',
		]);
		expect(messages(files("", "network: []"))).toEqual([
			"agents/worker/agent.md: network: an empty list reaches nothing: write none",
		]);
	});

	it("refuses web for an agent that reaches no site", () => {
		expect(messages(files("", "network: none", "[read, web]"))).toEqual([
			"agents/worker/agent.md: tools has web, but network is none: the agent could reach no site. Remove web, or give the agent the sites it reads",
		]);
		expect(messages(files("network: none\n", "", "[read, web]"))).toEqual([
			"agents/worker/agent.md: tools has web, but network is none: the agent could reach no site. Remove web, or give the agent the sites it reads",
		]);
		expect(
			messages(
				files("network: none\n", "network: [docs.stripe.com]", "[read, web]"),
			),
		).toEqual([]);
	});
});

describe("what a network reaches", () => {
	it("gives an agent its own network, else the factory's, else the package registries", () => {
		expect(agentNetwork({}, {})).toEqual(["packages"]);
		expect(agentNetwork({ network: "any" }, {})).toBe("any");
		expect(agentNetwork({ network: "any" }, { network: [] })).toEqual([]);
	});

	it("gives setup at least the package registries", () => {
		expect(setupNetwork({})).toEqual(["packages"]);
		expect(setupNetwork({ network: [] })).toEqual(["packages"]);
		expect(setupNetwork({ network: ["docs.stripe.com"] })).toEqual([
			"packages",
			"docs.stripe.com",
		]);
		expect(setupNetwork({ network: "any" })).toBe("any");
	});

	it("spells the registries out, once", () => {
		expect(networkSites("any")).toBe("any");
		expect(networkSites([])).toEqual([]);
		expect(networkSites(["packages", "registry.npmjs.org", "x.io"])).toEqual([
			...PACKAGE_SITES,
			"x.io",
		]);
	});

	it("lists, in the documentation, every site packages stands for", () => {
		const page = readFileSync(
			join(ROOT, "packages/docs/content/docs/factory/harness.mdx"),
			"utf8",
		);
		for (const site of PACKAGE_SITES)
			expect(page, site).toContain(`\`${site}\``);
	});

	it("tells whether a network reaches a host", () => {
		expect(reaches(["packages"], "registry.npmjs.org")).toBe(true);
		expect(reaches(["packages"], "docs.stripe.com")).toBe(false);
		expect(reaches(["*.sentry.io"], "us.sentry.io")).toBe(true);
		// A wildcard covers subdomains, not the domain itself, as in the sandbox.
		expect(reaches(["*.sentry.io"], "sentry.io")).toBe(false);
		expect(reaches(["*.sentry.io"], "evilsentry.io")).toBe(false);
		expect(reaches(["X.io"], "x.IO.")).toBe(true);
		expect(reaches("any", "anything.test")).toBe(true);
		expect(reaches([], "x.io")).toBe(false);
	});

	it("says a network in words", () => {
		expect(networkText([])).toBe("none");
		expect(networkText(["packages"])).toBe("packages");
		expect(networkText("any")).toBe("any site");
		expect(networkText(["packages", "x.io"])).toBe("packages, x.io");
	});

	it("tells the sites a network newly reaches", () => {
		expect(gainedSites(["packages"], ["packages", "x.io"])).toEqual(["x.io"]);
		expect(gainedSites([], ["packages"])).toEqual(["packages"]);
		expect(gainedSites(["packages"], "any")).toEqual(["any site"]);
		expect(gainedSites("any", [])).toEqual([]);
		expect(gainedSites(["x.io"], ["x.io"])).toEqual([]);
		// What the network reached already is no gain, however it is written.
		expect(gainedSites(["packages"], ["registry.npmjs.org"])).toEqual([]);
		expect(gainedSites(["*.x.io"], ["a.x.io", "*.b.x.io"])).toEqual([]);
		expect(gainedSites(["a.x.io"], ["*.x.io", "x.io"])).toEqual([
			"*.x.io",
			"x.io",
		]);
		expect(gainedSites(["registry.npmjs.org"], ["packages"])).toEqual([
			"packages",
		]);
	});
});

describe("the sites a factory names and its network does not reach", () => {
	const factory = (yaml: string, extra: FactoryFiles = {}) =>
		load({ ...files(yaml, ""), ...extra });

	it("reads setup, the commands, env and the scripts, and names where each site is", () => {
		const all = {
			...files(
				"setup: curl -fsSL https://get.tool.dev/install.sh | sh\ncommands:\n  pay: curl https://api.stripe.com/v1/x\n  vulns: scripts/check.sh\nenv:\n  API_URL: https://api.stripe.com\n",
				"",
			),
			"scripts/check.sh":
				'#!/bin/sh\n# Asks https://wpscan.com\napi="${API:-https://wpscan.com/api/v3}"\ncurl https://registry.npmjs.org/x\ncdn="https://cdn\\.x\\.io/"\n',
			// The scripts' tests call fakes: the engine never runs them.
			"scripts/test/check-test.mjs": "// https://fake.example.org\n",
		};
		expect(unlistedSites(load(all), all)).toEqual({
			"get.tool.dev": ["setup"],
			"api.stripe.com": ["command pay", "env API_URL"],
			"wpscan.com": ["scripts/check.sh"],
		});
	});

	it("takes a site any agent reaches, and leaves out the names of this machine and those reserved for examples", () => {
		const f = factory(
			"network: [packages, '*.stripe.com']\ncommands:\n  pay: curl https://api.stripe.com/v1/x\n  local: curl http://localhost:3000 http://app.localhost http://site.ddev.site https://example.com https://www.example.org https://site.invalid\n",
		);
		expect(unlistedSites(f, {})).toEqual({});
	});
});

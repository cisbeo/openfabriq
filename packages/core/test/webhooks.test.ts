import { describe, expect, it } from "vitest";
import { loadFactory } from "../src/factory/load.js";
import type { FactoryFiles } from "../src/factory/types.js";
import { workflowGraph } from "../src/graph.js";
import { type FactoryEvent, matchingAutomations } from "../src/match.js";
import { planChanges } from "../src/plan/plan.js";
import { load, NO_FILES } from "./helpers.js";

// Webhooks of the factory, received by the relay.

const FACTORY = "name: F\nrepository: acme/app\nmaintainers: [alice]\n";
const HOOKS =
	"webhooks:\n  deploy-failed:\n    signature: standard\n  sentry-fatal:\n    signature: sentry\n";
const files = (
	automation: string,
	yaml = `${FACTORY}${HOOKS}`,
): FactoryFiles => ({
	"factory.yaml": yaml,
	"agents/fixer/agent.md": "---\ndescription: Fixes\n---\nFix.\n",
	"automations/on-deploy/automation.md": `---\n${automation}\n---\nGo.\n`,
});
const messages = (f: FactoryFiles) =>
	loadFactory(f).problems.map((p) => `${p.file}: ${p.message}`);

describe("the format", () => {
	it("reads the webhooks and the automation that listens to one", () => {
		const { factory, problems } = loadFactory(
			files(
				"when:\n  webhook.received: { webhook: deploy-failed }\nagent: fixer\ncan: [create_issue]",
			),
		);
		expect(problems).toEqual([]);
		expect(factory?.webhooks).toEqual({
			"deploy-failed": { signature: "standard" },
			"sentry-fatal": { signature: "sentry" },
		});
		expect(factory?.automations["on-deploy"]?.when).toEqual([
			{ event: "webhook.received", webhook: "deploy-failed" },
		]);
	});

	it("refuses an unknown signature, a bad name, and a webhook the factory does not declare", () => {
		expect(
			messages(
				files(
					"when:\n  webhook.received: { webhook: deploy-faild }\nagent: fixer",
					`${FACTORY}webhooks:\n  deploy-failed:\n    signature: standard\n  Bad_Name:\n    signature: hmac\n`,
				),
			),
		).toEqual([
			"factory.yaml: webhooks.Bad_Name: a webhook name is lowercase letters, digits and -, like deploy-failed",
			'factory.yaml: unknown signature "hmac" in webhooks.Bad_Name.signature. Use one of: github, sentry, stripe, standard, none',
			'automations/on-deploy/automation.md: when.webhook.received names "deploy-faild", which is not in webhooks of factory.yaml. Did you mean "deploy-failed"?',
		]);
	});

	it("needs the webhook's name, takes it only on webhook.received, and refuses outputs with nowhere to go", () => {
		expect(
			messages(
				files("when: webhook.received\nagent: fixer\ncan: [add_comment]"),
			),
		).toEqual([
			"automations/on-deploy/automation.md: when.webhook.received needs the webhook's name, for example { webhook: deploy-failed }",
			"automations/on-deploy/automation.md: can.add_comment fits none of the events in when (webhook.received): a webhook has nowhere to answer",
		]);
		expect(
			messages(
				files(
					"when:\n  issue.opened: { webhook: deploy-failed }\nagent: fixer",
				),
			),
		).toEqual([
			"automations/on-deploy/automation.md: when.issue.opened does not take a webhook; only webhook.received does",
		]);
	});
});

describe("the engine", () => {
	const factory = load(
		files(
			"when:\n  webhook.received: { webhook: deploy-failed }\nagent: fixer\ncan: [create_issue]",
		),
	);
	const received = (webhook: string): FactoryEvent => ({
		key: `webhook:${webhook}:1`,
		event: "webhook.received",
		isPullRequest: false,
		actor: `webhook ${webhook}`,
		source: { kind: "webhook", webhook, delivery: "1", payload: "{}" },
		at: "2026-11-03T10:00:00Z",
	});

	it("starts the automations of that webhook only, whoever sent it: the signature is the gate", () => {
		expect(
			matchingAutomations(factory, received("deploy-failed")).map(
				(a) => a.name,
			),
		).toEqual(["on-deploy"]);
		expect(matchingAutomations(factory, received("sentry-fatal"))).toEqual([]);
	});

	it("draws the webhook in the workflow", () => {
		expect(
			workflowGraph(factory).nodes.find((n) => n.title === "webhook.received"),
		).toMatchObject({
			title: "webhook.received",
			detail: "deploy-failed",
			source: "webhook",
			entry: true,
		});
	});

	it("shows in plan that the Internet can start runs, and that it needs the relay", () => {
		const before = load(files("when: issue.opened\nagent: fixer", FACTORY));
		const plan = planChanges(
			before,
			load(
				files(
					"when:\n  webhook.received: { webhook: deploy-failed }\nagent: fixer\ncan: [create_issue]",
					`${FACTORY}webhooks:\n  deploy-failed:\n    signature: standard\n  open:\n    signature: none\n`,
				),
			),
			[],
			NO_FILES,
		);
		expect(plan.security).toEqual([
			'+ webhook deploy-failed, signed (standard); a signed request can now start automations ("openfabriq connect webhook deploy-failed")',
			'+ webhook open, not signed: anyone who has its address can start automations ("openfabriq connect webhook open")',
			"+ automation on-deploy can now create_issue",
			'+ automation on-deploy starts when the webhook deploy-failed is received; it arrives through the relay ("openfabriq connect relay")',
			"+ answer-mentions: the agent that opens issues, fixer, answers a maintainer's mention of @openfabriq on its issues, with a comment; on one a person opened, the last of them to work on it answers (answer_mentions: false in factory.yaml turns it off)",
		]);
		expect(
			planChanges(
				load(
					files(
						"when:\n  webhook.received: { webhook: deploy-failed }\nagent: fixer",
					),
				),
				before,
				[],
				NO_FILES,
			).settings,
		).toEqual([
			'- webhook deploy-failed; the relay accepts it until "openfabriq connect webhook deploy-failed --remove"',
			'- webhook sentry-fatal; the relay accepts it until "openfabriq connect webhook sentry-fatal --remove"',
		]);
	});

	it("shows a signature that changes, and nothing when the webhooks stay the same", () => {
		const listening = (yaml: string) =>
			load(
				files(
					"when:\n  webhook.received: { webhook: deploy-failed }\nagent: fixer\ncan: [create_issue]",
					yaml,
				),
			);
		const signed = listening(`${FACTORY}${HOOKS}`);
		const same = planChanges(signed, signed, [], NO_FILES);
		expect({ security: same.security, settings: same.settings }).toEqual({
			security: [],
			settings: [],
		});
		const opened = listening(
			`${FACTORY}${HOOKS.replace("signature: standard", "signature: none")}`,
		);
		expect(planChanges(signed, opened, [], NO_FILES).security).toEqual([
			"~ webhook deploy-failed: not signed: anyone who has its address can start automations",
		]);
	});
});

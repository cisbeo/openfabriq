import { describe, expect, it } from "vitest";
import type { FactoryFiles } from "../../src/factory/types.js";
import { planChanges } from "../../src/plan/plan.js";
import { load, NO_FILES, sdlcFiles } from "../helpers.js";

const BASE = sdlcFiles();
const YAML = BASE["factory.yaml"] as string;
const REVIEW = "automations/review-pull-requests/automation.md";

/** The sdlc fixture, with lines added to factory.yaml and files replaced or added. */
const sdlc = (yaml = "", files: FactoryFiles = {}) =>
	load({ ...BASE, "factory.yaml": `${YAML}${yaml}`, ...files });
const sdlcYaml = (edit: (yaml: string) => string) =>
	load({ ...BASE, "factory.yaml": edit(YAML) });
const review = (header: string) => ({
	[REVIEW]: `---\n${header}\n---\nReview this pull request.\n`,
});
const automation = (name: string, header: string) => ({
	[`automations/${name}/automation.md`]: `---\n${header}\n---\nDo it.\n`,
});
const agent = (name: string, header: string) => ({
	[`agents/${name}/agent.md`]: `---\n${header}\n---\nWork.\n`,
});

type Lines = { security?: string[]; settings?: string[] };

/**
 * One change to the factory, the lines the plan must show for it, and the lines for the
 * change undone: a power gained is a security line, the same power given back is not.
 */
const cases: [
	string,
	ReturnType<typeof sdlc>,
	ReturnType<typeof sdlc>,
	Lines,
	Lines,
][] = [
	[
		"repository",
		sdlc(),
		sdlcYaml((y) => y.replace("acme/task-app", "acme/app")),
		{ security: ["~ repository: acme/task-app → acme/app"] },
		{ security: ["~ repository: acme/app → acme/task-app"] },
	],
	[
		"limit",
		sdlc(),
		sdlcYaml((y) => y.replace("usd_per_run: 5", "usd_per_run: 3")),
		{ settings: ["~ limit usd_per_run lowered: 5 → 3"] },
		{ security: ["~ limit usd_per_run raised: 3 → 5"] },
	],
	[
		"commands",
		sdlc(),
		sdlc("commands:\n  test: npm test\n  lint: npm run lint\n"),
		{
			security: [
				"+ command lint runs on this machine: npm run lint",
				"+ command test runs on this machine: npm test",
			],
		},
		{ settings: ["- command lint", "- command test"] },
	],
	[
		"checks",
		sdlc("commands:\n  test: npm test\n  lint: npm run lint\nchecks: [test]\n"),
		sdlc(
			"commands:\n  test: npm test\n  lint: npm run lint\nchecks: [test, lint]\n",
		),
		{ settings: ["+ checks: lint"] },
		{ security: ["- checks no longer run lint"] },
	],
	[
		"env",
		sdlc("env:\n  Z: gone\n  Y: gone\n  A: same\n  B: old\n"),
		sdlc("env:\n  D: new\n  C: new\n  A: same\n  B: changed\n"),
		{
			security: [
				"~ env B: old → changed",
				"+ env C=new, for setup, commands and agents",
				"+ env D=new, for setup, commands and agents",
				"- env Y",
				"- env Z",
			],
		},
		{
			security: [
				"~ env B: changed → old",
				"+ env Y=gone, for setup, commands and agents",
				"+ env Z=gone, for setup, commands and agents",
				"- env C",
				"- env D",
			],
		},
	],
	[
		"secrets",
		sdlc("secrets: [A, B]\n"),
		sdlc("secrets: [B, C]\n"),
		{
			security: [
				"+ secret C, from this machine, for setup and commands",
				"- secret A",
			],
		},
		{
			security: [
				"+ secret A, from this machine, for setup and commands",
				"- secret C",
			],
		},
	],
	[
		"timezone changed",
		sdlc("timezone: Europe/Paris\n"),
		sdlc("timezone: UTC\n"),
		{ settings: ["~ timezone Europe/Paris → UTC"] },
		{ settings: ["~ timezone UTC → Europe/Paris"] },
	],
	[
		"timezone removed",
		sdlc("timezone: Europe/Paris\n"),
		sdlc(),
		{
			settings: [
				"- timezone Europe/Paris: schedules read in the machine's time zone",
			],
		},
		{
			settings: ["+ timezone Europe/Paris: schedules read in this time zone"],
		},
	],
	[
		"signature",
		sdlc(),
		sdlc("signature: false\n"),
		{
			settings: [
				"- signature: what the factory writes on GitHub no longer says openfabriq wrote it",
			],
		},
		{
			settings: [
				"+ signature: what the factory writes on GitHub says openfabriq wrote it",
			],
		},
	],
	[
		"slack, linear and sentry",
		sdlc(),
		sdlc(
			"integrations:\n  slack:\n    channel: factory\n  linear:\n    team: ENG\n  sentry:\n    organization: acme\n    project: app\n    url: https://sentry.acme.dev\n",
		),
		{
			security: [
				'+ slack: channel #factory; people in the channel can now start automations, through the relay ("openfabriq connect slack")',
				'+ linear: team ENG; people of the team can now start automations, through the relay ("openfabriq connect linear")',
				'+ sentry: project acme/app on https://sentry.acme.dev; its new issues can now start automations, through the relay ("openfabriq connect sentry")',
			],
		},
		{
			settings: [
				"- slack: channel #factory",
				"- linear: team ENG",
				"- sentry: project acme/app on https://sentry.acme.dev",
			],
		},
	],
	[
		"slack channel",
		sdlc("integrations:\n  slack:\n    channel: a\n"),
		sdlc("integrations:\n  slack:\n    channel: b\n"),
		{
			security: [
				"~ slack: channel #a → channel #b; people in the channel can now start automations",
			],
		},
		{
			security: [
				"~ slack: channel #b → channel #a; people in the channel can now start automations",
			],
		},
	],
	[
		"maintainer",
		sdlc(),
		sdlcYaml((y) => y.replace("[ada]", "[ada, bob]")),
		{ security: ["+ maintainer bob can now start automations"] },
		{ settings: ["- maintainer bob"] },
	],
	[
		"agents, by name",
		sdlc(),
		sdlc("", {
			...agent("zeta", "description: Z\ntools: [read, web]"),
			...agent("alpha", "description: A\ntools: [read, web]"),
		}),
		{
			security: [
				"+ agent alpha can now use web",
				"+ agent zeta can now use web",
			],
		},
		{},
	],
	[
		"automations, by name, one for anyone",
		sdlc(),
		sdlc("", {
			...automation(
				"zeta",
				"when: issue.opened\nagent: triage\ncan: [add_comment]",
			),
			...automation(
				"alpha",
				"when: issue.opened\nagent: triage\nfrom: anyone\ncan: [add_comment]",
			),
		}),
		{
			security: [
				"+ automation alpha can now add_comment",
				"+ automation alpha now starts for anyone, not only maintainers",
				"+ automation zeta can now add_comment",
			],
		},
		{},
	],
	[
		"a label restriction widened",
		sdlc(),
		sdlc(
			"",
			review(
				"when: [pull_request.opened, pull_request.updated]\nagent: reviewer\ncan:\n  - add_comment\n  - request_changes\n  - add_labels: [needs-human, needs-info, needs-investigation]",
			),
		),
		{
			security: [
				"+ automation review-pull-requests can now add_labels (needs-info, needs-investigation)",
			],
		},
		{},
	],
	[
		"closing the pull request",
		sdlc(),
		sdlc(
			"",
			review(
				"when: [pull_request.opened, pull_request.updated]\nagent: reviewer\ncan:\n  - add_comment\n  - request_changes\n  - add_labels: [needs-human]\n  - close_pr",
			),
		),
		{ security: ["+ automation review-pull-requests can now close_pr"] },
		{},
	],
	[
		"merging under conditions",
		sdlc(),
		sdlc(
			"",
			review(
				'when: [pull_request.opened, pull_request.updated]\nagent: reviewer\ncan:\n  - add_comment\n  - request_changes\n  - add_labels: [needs-human]\n  - merge_pull_request: { only_paths: ["docs/**"], except_paths: ["docs/legal/**"] }',
			),
		),
		{
			security: [
				"+ automation review-pull-requests can now merge_pull_request (only docs/**; except docs/legal/**)",
			],
		},
		{},
	],
	[
		"a merge widened to any files",
		sdlc(
			"",
			review(
				'when: [pull_request.opened, pull_request.updated]\nagent: reviewer\ncan:\n  - add_comment\n  - request_changes\n  - add_labels: [needs-human]\n  - merge_pull_request: { labels: [needs-human], only_paths: ["docs/**"] }',
			),
		),
		sdlc(
			"",
			review(
				"when: [pull_request.opened, pull_request.updated]\nagent: reviewer\ncan:\n  - add_comment\n  - request_changes\n  - add_labels: [needs-human]\n  - merge_pull_request: { labels: [needs-human] }",
			),
		),
		{
			security: [
				"+ automation review-pull-requests can now merge_pull_request (labels needs-human): any pull request it allows, whatever files it changes",
			],
		},
		{},
	],
	[
		"paths renamed only_paths, the same list",
		sdlc(
			"",
			review(
				'when: [pull_request.opened, pull_request.updated]\nagent: reviewer\ncan:\n  - add_comment\n  - request_changes\n  - add_labels: [needs-human]\n  - merge_pull_request: { paths: ["docs/**"] }',
			),
		),
		sdlc(
			"",
			review(
				'when: [pull_request.opened, pull_request.updated]\nagent: reviewer\ncan:\n  - add_comment\n  - request_changes\n  - add_labels: [needs-human]\n  - merge_pull_request: { only_paths: ["docs/**"] }',
			),
		),
		{},
		{},
	],
	[
		"labels on the issues an automation opens",
		sdlc(
			"",
			automation(
				"nightly",
				'when:\n  schedule: { cron: "0 3 * * *" }\nagent: triage\ncan: [create_issue]',
			),
		),
		sdlc(
			"",
			automation(
				"nightly",
				'when:\n  schedule: { cron: "0 3 * * *" }\nagent: triage\ncan:\n  - create_issue: [ready-for-agent]',
			),
		),
		{
			security: ["+ automation nightly can now create_issue (ready-for-agent)"],
		},
		{},
	],
	[
		"a label restriction lifted",
		sdlc(),
		sdlc(
			"",
			review(
				"when: [pull_request.opened, pull_request.updated]\nagent: reviewer\ncan:\n  - add_comment\n  - request_changes\n  - add_labels",
			),
		),
		{
			security: [
				"+ automation review-pull-requests can now add_labels (any label)",
			],
		},
		{},
	],
	[
		"labels on any label",
		sdlc(
			"",
			review("when: pull_request.opened\nagent: reviewer\ncan: [add_comment]"),
		),
		sdlc(
			"",
			review(
				"when: pull_request.opened\nagent: reviewer\ncan: [add_comment, add_labels, remove_labels]",
			),
		),
		{
			security: [
				"+ automation review-pull-requests can now add_labels (any label)",
				"+ automation review-pull-requests can now remove_labels (any label)",
			],
		},
		{},
	],
	[
		"anyone, on other events",
		sdlc(
			"",
			review("when: pull_request.opened\nagent: reviewer\ncan: [add_comment]"),
		),
		sdlc(
			"",
			review(
				"when: issue.commented\nagent: reviewer\nfrom: anyone\ncan: [add_comment]",
			),
		),
		{
			security: [
				"+ automation review-pull-requests now starts for anyone, not only maintainers",
			],
		},
		{},
	],
	[
		"an automation handed to an agent with more tools",
		sdlc(),
		sdlc(
			"",
			review(
				"when: [pull_request.opened, pull_request.updated]\nagent: implementer\ncan:\n  - add_comment\n  - request_changes\n  - add_labels: [needs-human]",
			),
		),
		{
			security: [
				"~ automation review-pull-requests now runs implementer, which can use edit",
			],
		},
		{},
	],
	[
		"an agent that reaches new sites",
		sdlc(),
		sdlc(
			"",
			agent(
				"reviewer",
				"description: Reviews\ntools: [read, shell]\nnetwork: [packages, docs.stripe.com, '*.sentry.io']",
			),
		),
		{
			security: [
				"+ agent reviewer can now reach docs.stripe.com and *.sentry.io",
			],
		},
		{},
	],
	[
		"a factory that reaches any site",
		sdlc("setup: pnpm install\n"),
		sdlc("setup: pnpm install\nnetwork: any\n"),
		{
			security: [
				"+ agent implementer can now reach any site",
				"+ agent investigator can now reach any site",
				"+ agent reviewer can now reach any site",
				"+ agent rework can now reach any site",
				"+ agent triage can now reach any site",
				"+ setup can now reach any site",
			],
			settings: ["~ network: packages → any site"],
		},
		{ settings: ["~ network: any site → packages"] },
	],
	[
		"a factory cut off, with an agent that keeps the registries",
		sdlc(),
		sdlc(
			"network: none\n",
			agent("triage", "description: Triages\nnetwork: packages"),
		),
		{ settings: ["~ network: packages → none"] },
		{
			security: [
				"+ agent implementer can now reach the package registries",
				"+ agent investigator can now reach the package registries",
				"+ agent reviewer can now reach the package registries",
				"+ agent rework can now reach the package registries",
			],
			settings: ["~ network: none → packages"],
		},
	],
	[
		"anyone, same events, new instructions",
		sdlc(
			"",
			review(
				"when: pull_request.opened\nagent: reviewer\nfrom: anyone\ncan: [add_comment]",
			),
		),
		sdlc("", {
			[REVIEW]:
				"---\nwhen: pull_request.opened\nagent: reviewer\nfrom: anyone\ncan: [add_comment]\n---\nReview it twice.\n",
		}),
		{},
		{},
	],
];

describe("security lines", () => {
	it.each(cases)("%s", (_, before, after, forward, reverse) => {
		for (const [from, to, want] of [
			[before, after, forward],
			[after, before, reverse],
		] as const) {
			const plan = planChanges(from, to, [], NO_FILES);
			expect({ security: plan.security, settings: plan.settings }).toEqual({
				security: want.security ?? [],
				settings: want.settings ?? [],
			});
		}
	});

	it("reads a first apply of a factory that uses every place, without a before", () => {
		const after = load({
			"factory.yaml":
				"name: F\nrepository: acme/app\nmaintainers: [alice]\nsetup: pnpm install\ntimezone: UTC\nintegrations:\n  slack:\n    channel: factory\n",
			"agents/worker/agent.md": "---\ndescription: Does things\n---\nDo.\n",
			"automations/go/automation.md":
				"---\nwhen: issue.opened\nagent: worker\nfrom: anyone\ncan: [add_comment]\n---\nGo.\n",
		});
		const plan = planChanges(undefined, after, [], NO_FILES);
		expect(plan.security).toEqual([
			"+ setup runs on this machine before every agent: pnpm install",
			'+ slack: channel #factory; people in the channel can now start automations, through the relay ("openfabriq connect slack")',
			"+ maintainer alice can now start automations",
			"+ automation go can now add_comment",
			"+ automation go now starts for anyone, not only maintainers",
		]);
		expect(plan.settings).toEqual([
			"+ timezone UTC: schedules read in this time zone",
		]);
	});

	it("reports an automation that continues what the factory wrote", () => {
		const files = {
			"factory.yaml": "name: F\nrepository: acme/app\nmaintainers: [alice]\n",
			"agents/worker/agent.md": "---\ndescription: Does things\n---\nDo.\n",
			"automations/go/automation.md":
				"---\nwhen: issue.labeled\nagent: worker\ncan: [add_comment]\n---\nGo.\n",
		};
		const before = load(files);
		const after = load({
			...files,
			"automations/go/automation.md":
				"---\nwhen: issue.labeled\nagent: worker\nfrom: factory\ncan: [add_comment]\n---\nGo.\n",
		});
		expect(planChanges(before, after, [], NO_FILES).security).toEqual([
			"+ automation go now also continues what the factory wrote in a run that Sentry, a webhook or someone outside the maintainers started",
		]);
	});

	it("reads a first apply without a time zone, with a webhook", () => {
		const after = load({
			"factory.yaml":
				"name: F\nrepository: acme/app\nmaintainers: [alice]\nwebhooks:\n  deploy:\n    signature: standard\n",
			"agents/worker/agent.md": "---\ndescription: Does things\n---\nDo.\n",
			"automations/go/automation.md":
				"---\nwhen:\n  webhook.received: { webhook: deploy }\nagent: worker\ncan: [create_issue]\n---\nGo.\n",
		});
		const plan = planChanges(undefined, after, [], NO_FILES);
		expect(plan.security).toEqual([
			'+ webhook deploy, signed (standard); a signed request can now start automations ("openfabriq connect webhook deploy")',
			"+ maintainer alice can now start automations",
			"+ automation go can now create_issue",
			'+ automation go starts when the webhook deploy is received; it arrives through the relay ("openfabriq connect relay")',
			"+ answer-mentions: the agent that opens issues, worker, answers a maintainer's mention of @openfabriq on its issues, with a comment; on one a person opened, the last of them to work on it answers (answer_mentions: false in factory.yaml turns it off)",
		]);
		expect(plan.settings).toEqual([]);
	});

	it("names each file the plan does not describe, skill files first, in path order", () => {
		const before = {
			"z.md": "1",
			"skills/a/SKILL.md": "x",
			"agents/implementer/skills/t/SKILL.md": "x",
			"agents/triage/agent.md": "a",
			"automations/go/automation.md": "a",
			"factory.yaml": "a",
		};
		const after = {
			"z.md": "2",
			"a.sh": "x",
			"agents/implementer/skills/t/SKILL.md": "y",
			"agents/triage/agent.md": "b",
			"automations/go/automation.md": "b",
			"docs/skills/notes.md": "x",
			"factory.yaml": "b",
			"factory.yaml.bak": "x",
			"docs/factory.yaml": "x",
		};
		const plan = planChanges(sdlc(), sdlc(), [], { before, after });
		expect(plan.security).toEqual([
			"~ skill file agents/implementer/skills/t/SKILL.md changed",
			"- skill file skills/a/SKILL.md",
		]);
		expect(plan.settings).toEqual([
			"+ file a.sh",
			"+ file docs/factory.yaml",
			"+ file docs/skills/notes.md",
			"+ file factory.yaml.bak",
			"~ file z.md changed",
		]);
	});

	it("shows each script added, changed or removed as a security change, and their tests as settings", () => {
		const before = {
			"scripts/old.sh": "#!/bin/sh\n",
			"scripts/report.mjs": "#!/usr/bin/env node\n",
			"scripts/test/report.test.mjs": "a",
		};
		const after = {
			"scripts/lib/common.sh": "#!/bin/sh\n",
			"scripts/report.mjs": "#!/usr/bin/env node\nconsole.log(1);\n",
			"scripts/test/report.test.mjs": "b",
		};
		const plan = planChanges(sdlc(), sdlc(), [], { before, after });
		expect(plan.security).toEqual([
			"+ script scripts/lib/common.sh",
			"- script scripts/old.sh",
			"~ script scripts/report.mjs changed",
		]);
		expect(plan.settings).toEqual([
			"~ file scripts/test/report.test.mjs changed",
		]);
	});
});

describe("MCP servers", () => {
	const SERVERS =
		"secrets: [MCP_TOKEN, DB_URL]\nmcp:\n  sentry:\n    url: https://mcp.sentry.dev/mcp\n    secret: MCP_TOKEN\n  test-db:\n    command: npx -y server-postgres\n    secrets: [DB_URL]\n";
	const plan = (
		before: ReturnType<typeof sdlc>,
		after: ReturnType<typeof sdlc>,
	) => planChanges(before, after, [], NO_FILES);
	const triage = (header: string) =>
		agent("triage", `description: Triage\ntools: [read]\nmcp:\n  ${header}`);

	it("shows a server added, changed or removed, and what runs on this machine", () => {
		const secrets = [
			"+ secret MCP_TOKEN, from this machine, for setup and commands",
			"+ secret DB_URL, from this machine, for setup and commands",
		];
		expect(plan(sdlc(), sdlc(SERVERS)).security).toEqual([
			...secrets,
			"+ mcp server sentry, at https://mcp.sentry.dev/mcp, with the secret MCP_TOKEN",
			"+ mcp server test-db runs on this machine: npx -y server-postgres, with the secrets DB_URL",
		]);
		const moved = sdlc(SERVERS.replace("mcp.sentry.dev", "sentry.acme.dev"));
		expect(plan(sdlc(SERVERS), moved).security).toEqual([
			"~ mcp server sentry: at https://mcp.sentry.dev/mcp, with the secret MCP_TOKEN → at https://sentry.acme.dev/mcp, with the secret MCP_TOKEN",
		]);
		const removed = plan(sdlc(SERVERS), sdlc());
		expect(removed.settings).toEqual([
			"- mcp server sentry",
			"- mcp server test-db",
		]);
	});

	it("shows each tool an agent can newly call", () => {
		const before = sdlc(SERVERS, triage("sentry: [search_issues]"));
		const after = sdlc(
			SERVERS,
			triage("sentry: [search_issues, resolve_issue]\n  test-db: [query]"),
		);
		const changes = plan(before, after);
		expect(changes.security).toEqual([
			"+ agent triage can now call sentry.resolve_issue",
			"+ agent triage can now call test-db.query",
		]);
		expect(changes.agents).toEqual([
			"~ triage: mcp sentry.search_issues → sentry.search_issues, sentry.resolve_issue, test-db.query",
		]);
		// The servers did not change: nothing to say about them.
		expect(changes.settings).toEqual([]);
		expect(plan(after, before).security).toEqual([]);
	});
});

describe("places", () => {
	it("says the time zone, then the webhooks, then Slack, Linear and Sentry", () => {
		const everywhere = sdlc(
			"timezone: UTC\nwebhooks:\n  deploy:\n    signature: standard\nintegrations:\n  slack:\n    channel: factory\n",
		);
		const lines = (
			before: ReturnType<typeof sdlc>,
			after: ReturnType<typeof sdlc>,
		) => {
			const { security, settings } = planChanges(before, after, [], NO_FILES);
			return { security, settings };
		};
		expect(lines(sdlc(), everywhere)).toEqual({
			security: [
				'+ webhook deploy, signed (standard); a signed request can now start automations ("openfabriq connect webhook deploy")',
				'+ slack: channel #factory; people in the channel can now start automations, through the relay ("openfabriq connect slack")',
			],
			settings: ["+ timezone UTC: schedules read in this time zone"],
		});
		expect(lines(everywhere, sdlc())).toEqual({
			security: [],
			settings: [
				"- timezone UTC: schedules read in the machine's time zone",
				'- webhook deploy; the relay accepts it until "openfabriq connect webhook deploy --remove"',
				"- slack: channel #factory",
			],
		});
	});
});

describe("powers", () => {
	const YAML_ALL =
		"name: F\nrepository: acme/app\nmaintainers: [alice]\nintegrations:\n  linear:\n    team: ENG\nwebhooks:\n  deploy:\n    signature: standard\nmcp:\n  docs:\n    url: https://mcp.acme.dev/mcp\n";
	const files = (extra: FactoryFiles) =>
		load({
			"factory.yaml": YAML_ALL,
			...agent("alpha", "description: Alpha\ntools: [read]"),
			...agent("beta", "description: Beta\ntools: [read]"),
			...automation(
				"a",
				"when: issue.commented\nagent: alpha\nfrom: anyone\ncan: [add_comment]",
			),
			...extra,
		});

	it("says what an automation handed to an existing agent can newly call and reach, not only use", () => {
		const reacher = agent(
			"beta",
			"description: Beta\ntools: [read]\nnetwork: any\nmcp:\n  docs: [search]",
		);
		const before = files(reacher);
		const after = files({
			...reacher,
			...automation(
				"a",
				"when: issue.commented\nagent: beta\nfrom: anyone\ncan: [add_comment]",
			),
		});
		expect(planChanges(before, after, [], NO_FILES).security).toEqual([
			"~ automation a now runs beta, which can call docs.search",
			"~ automation a now runs beta, which can reach any site",
		]);
		expect(planChanges(after, before, [], NO_FILES).security).toEqual([]);
	});

	it("lists the agents' tools, then their MCP tools, then each automation's gains, in name order", () => {
		const before = files({});
		const after = files({
			...agent(
				"alpha",
				"description: Alpha\ntools: [read, web]\nmcp:\n  docs: [search]",
			),
			...agent(
				"beta",
				"description: Beta\ntools: [read, edit]\nmcp:\n  docs: [fetch]",
			),
			...automation(
				"a",
				"when:\n  issue.commented: {}\n  webhook.received: { webhook: deploy }\n  linear.issue.delegated: {}\nagent: beta\nfrom: anyone\ncan: [add_comment, create_issue]",
			),
			...automation(
				"b",
				"when: issue.labeled\nagent: alpha\nfrom: factory\ncan: [add_comment]",
			),
			...automation(
				"c",
				"when: issue.labeled\nagent: alpha\nfrom: anyone\ncan: [add_comment]",
			),
		});
		expect(planChanges(before, after, [], NO_FILES).security).toEqual([
			"+ agent alpha can now use web",
			"+ agent beta can now use edit",
			"+ agent alpha can now call docs.search",
			"+ agent beta can now call docs.fetch",
			"+ automation a can now create_issue",
			'+ automation a starts when the webhook deploy is received; it arrives through the relay ("openfabriq connect relay")',
			'+ automation a starts when someone of the Linear team hands an issue to openfabriq; it arrives through the relay ("openfabriq connect relay") and needs openfabriq installed in Linear as an agent ("openfabriq connect linear")',
			"~ automation a now runs beta, which can use edit",
			"~ automation a now runs beta, which can call docs.fetch",
			"~ automation a starts for anyone on new events: issue.commented, webhook.received (deploy), linear.issue.delegated",
			"+ automation b can now add_comment",
			"+ automation b now also continues what the factory wrote in a run that Sentry, a webhook or someone outside the maintainers started",
			"+ automation c can now add_comment",
			"+ automation c now starts for anyone, not only maintainers",
		]);
	});
});

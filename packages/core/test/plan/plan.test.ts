import { describe, expect, it } from "vitest";
import type { Factory, FactoryFiles } from "../../src/factory/types.js";
import { formatPlan, isEmptyPlan } from "../../src/plan/format.js";
import { planChanges } from "../../src/plan/plan.js";
import { load, NO_FILES, sdlcFiles } from "../helpers.js";

/** The sdlc fixture with some files replaced. */
function sdlc(changes: FactoryFiles = {}): Factory {
	return load({ ...sdlcFiles(), ...changes });
}

const REVIEW = "automations/review-pull-requests/automation.md";
const reviewWith = (header: string) =>
	`---\n${header}\n---\nReview this pull request.\n`;

describe("planChanges", () => {
	it("on a first apply, adds everything and lists every permission as a security change", () => {
		const plan = planChanges(undefined, sdlc(), ["bug"], NO_FILES);
		expect(plan.counts).toEqual({ add: 10, change: 0, remove: 0 });
		expect(plan.labels).toEqual([
			"needs-human",
			"needs-info",
			"needs-investigation",
			"openfabriq:working",
			"ready-for-agent",
		]);
		expect(plan.security).toContain(
			"+ automation implement-ready-issues can now create_pull_request",
		);
		expect(plan.security).toContain(
			"+ automation triage-issues can now add_labels (ready-for-agent, needs-info, needs-investigation, needs-human)",
		);
		expect(plan.security).toContain("+ agent implementer can now use shell");
		expect(plan.security).toContain(
			"+ maintainer ada can now start automations",
		);
	});

	it("shows nothing when nothing changed, and skips labels GitHub already has", () => {
		const plan = planChanges(
			sdlc(),
			sdlc(),
			[
				"Ready-For-Agent",
				"needs-info",
				"needs-investigation",
				"needs-human",
				"openfabriq:working",
			],
			NO_FILES,
		);
		expect(plan.counts).toEqual({ add: 0, change: 0, remove: 0 });
		expect(formatPlan(plan)).toBe(
			"No changes. The factory matches what is applied.",
		);
	});

	it("sees a maintainer whose login only changed case as the same person", () => {
		const after = sdlc({
			"factory.yaml": sdlcFiles()["factory.yaml"]?.replace(
				"maintainers: [ada]",
				"maintainers: [Ada]",
			) as string,
		});
		expect(
			isEmptyPlan(
				planChanges(
					sdlc(),
					after,
					[
						"ready-for-agent",
						"needs-info",
						"needs-investigation",
						"needs-human",
						"openfabriq:working",
					],
					NO_FILES,
				),
			),
		).toBe(true);
	});

	it("shows an added agent and a changed trigger", () => {
		const before = sdlc();
		const after = sdlc({
			"agents/docs/agent.md":
				"---\ndescription: Keeps the docs up to date\n---\nWrite docs.\n",
			"automations/document/automation.md":
				"---\nwhen:\n  pull_request.labeled: { labels: [needs-docs] }\nagent: docs\n---\nDocument it.\n",
			[REVIEW]: reviewWith(
				"when: pull_request.opened\nagent: reviewer\ncan:\n  - add_comment\n  - request_changes\n  - add_labels: [needs-human]",
			),
		});
		const plan = planChanges(before, after, [], NO_FILES);
		expect(plan.agents).toEqual(["+ docs: Keeps the docs up to date"]);
		expect(plan.automations).toEqual([
			"+ document: when pull_request.labeled (needs-docs) → docs, can nothing",
			"~ review-pull-requests: when pull_request.opened, pull_request.updated → pull_request.opened; instructions changed",
		]);
		expect(plan.labels).toContain("needs-docs");
		expect(plan.counts).toEqual({ add: 2, change: 1, remove: 0 });
		expect(plan.security).toEqual([]);
	});

	it("puts widened permissions, anyone, new tools and raised limits first", () => {
		const after = sdlc({
			[REVIEW]: reviewWith(
				"when: [pull_request.opened, pull_request.updated]\nagent: reviewer\nfrom: anyone\ncan:\n  - add_comment\n  - request_changes\n  - add_labels\n  - create_issue",
			),
			"agents/triage/agent.md": sdlcFiles()["agents/triage/agent.md"]?.replace(
				"tools: [read]",
				"tools: [read, web]",
			) as string,
			"factory.yaml": sdlcFiles()["factory.yaml"]?.replace(
				"usd_per_run: 5",
				"usd_per_run: 10",
			) as string,
		});
		const plan = planChanges(sdlc(), after, [], NO_FILES);
		expect(plan.security).toEqual([
			"~ limit usd_per_run raised: 5 → 10",
			"+ agent triage can now use web",
			"+ automation review-pull-requests can now add_labels (any label)",
			"+ automation review-pull-requests can now create_issue",
			"+ automation review-pull-requests now starts for anyone, not only maintainers",
		]);
	});

	it("flags an automation that moves to a stronger agent, or to new public events", () => {
		const anyone = (when: string, agent: string) =>
			reviewWith(
				`when: ${when}\nagent: ${agent}\nfrom: anyone\ncan: [add_comment]`,
			);
		const before = sdlc({ [REVIEW]: anyone("pull_request.labeled", "triage") });
		const after = sdlc({ [REVIEW]: anyone("issue.commented", "implementer") });
		expect(planChanges(before, after, [], NO_FILES).security).toEqual([
			"~ automation review-pull-requests now runs implementer, which can use edit, shell",
			"~ automation review-pull-requests starts for anyone on new events: issue.commented",
		]);
		expect(planChanges(after, before, [], NO_FILES).security).toEqual([
			"~ automation review-pull-requests starts for anyone on new events: pull_request.labeled",
		]);
	});

	it("shows removals", () => {
		const files = sdlcFiles();
		delete files["automations/investigate-bugs/automation.md"];
		delete files["agents/investigator/agent.md"];
		const plan = planChanges(sdlc(), load(files), [], NO_FILES);
		expect(plan.agents).toEqual(["- investigator"]);
		expect(plan.automations).toEqual(["- investigate-bugs"]);
		expect(plan.settings).toEqual([]);
		expect(plan.counts).toEqual({ add: 0, change: 0, remove: 2 });
	});
});

it("flags setup as a security change, and shows ignore_paths in the trigger", () => {
	const factoryYaml = sdlcFiles()["factory.yaml"] as string;
	const withSetup = sdlc({
		"factory.yaml": `${factoryYaml}setup: pnpm install\n`,
		[REVIEW]: reviewWith(
			'when:\n  pull_request.opened: { ignore_paths: ["openfabriq/**"] }\nagent: reviewer\ncan:\n  - add_comment\n  - request_changes\n  - add_labels: [needs-human]',
		),
	});
	const added = planChanges(sdlc(), withSetup, [], NO_FILES);
	expect(added.security).toEqual([
		"+ setup runs on this machine before every agent: pnpm install",
	]);
	expect(added.automations).toEqual([
		"~ review-pull-requests: when pull_request.opened, pull_request.updated → pull_request.opened (ignoring openfabriq/**); instructions changed",
	]);
	const changed = planChanges(
		withSetup,
		sdlc({
			"factory.yaml": `${factoryYaml}setup: [pnpm install, pnpm build]\n`,
		}),
		[],
		NO_FILES,
	);
	expect(changed.security).toEqual([
		"~ setup: pnpm install → pnpm install, pnpm build",
	]);
	expect(planChanges(withSetup, sdlc(), [], NO_FILES).settings).toContain(
		"- setup: pnpm install",
	);
});

it("formatPlan reads like a report, security first", () => {
	const after = load({
		"factory.yaml": "name: F\nrepository: acme/app\nmaintainers: [alice]\n",
		"agents/worker/agent.md": "---\ndescription: Does things\n---\nDo.\n",
		"automations/go/automation.md":
			"---\nwhen:\n  issue.labeled: { labels: [go] }\nagent: worker\ncan: [add_comment]\n---\nGo.\n",
	});
	expect(formatPlan(planChanges(undefined, after, ["go"], NO_FILES))).toBe(
		[
			"Security changes (read these first)",
			"  + maintainer alice can now start automations",
			"  + automation go can now add_comment",
			"",
			"Agents",
			"  + worker: Does things",
			"",
			"Automations",
			"  + go: when issue.labeled (go) → worker, can add_comment",
			"",
			"Labels to create on GitHub",
			"  + needs-human",
			"  + openfabriq:working",
			"",
			"Plan: 2 to add, 0 to change, 0 to remove, 2 labels to create.",
		].join("\n"),
	);
});

it("shows the agent that reviews an automation's change, and flags its removal as a guard less", () => {
	const IMPLEMENT = "automations/implement-ready-issues/automation.md";
	const reviewed = sdlc({
		[IMPLEMENT]: sdlcFiles()[IMPLEMENT]?.replace(
			"agent: implementer\n",
			"agent: implementer\nreviewed_by: reviewer\n",
		) as string,
	});
	const added = planChanges(sdlc(), reviewed, [], NO_FILES);
	expect(added.automations).toEqual([
		"~ implement-ready-issues: reviewed by nobody → reviewer",
	]);
	expect(added.security).toEqual([]);
	expect(planChanges(undefined, reviewed, [], NO_FILES).automations).toContain(
		"+ implement-ready-issues: when issue.labeled (ready-for-agent) → implementer, reviewed by reviewer, can create_pull_request, add_comment, remove_labels (ready-for-agent), add_labels (needs-info)",
	);
	// The labels the engine puts after a review, created with the others; only for a factory that reviews.
	expect(planChanges(sdlc(), reviewed, [], NO_FILES).labels).toEqual(
		expect.arrayContaining([
			"ready-to-merge",
			"risk:low",
			"risk:medium",
			"risk:high",
		]),
	);
	expect(planChanges(undefined, sdlc(), [], NO_FILES).labels).not.toContain(
		"risk:low",
	);
	const removed = planChanges(reviewed, sdlc(), [], NO_FILES);
	expect(removed.security).toEqual([
		"- automation implement-ready-issues: reviewer no longer reviews its change before it leaves the machine",
	]);
	// Another reviewer still reviews it: a change, not a guard less.
	const otherReviewer = planChanges(
		reviewed,
		sdlc({
			[IMPLEMENT]: sdlcFiles()[IMPLEMENT]?.replace(
				"agent: implementer\n",
				"agent: implementer\nreviewed_by: triage\n",
			) as string,
		}),
		[],
		NO_FILES,
	);
	expect(otherReviewer.security).toEqual([]);
	expect(otherReviewer.automations).toEqual([
		"~ implement-ready-issues: reviewed by reviewer → triage",
	]);
});

it("flags commands as security changes, and a removed check too", () => {
	const factoryYaml = sdlcFiles()["factory.yaml"] as string;
	const harness = (extra: string) =>
		sdlc({
			"factory.yaml": `${factoryYaml}commands:\n  test: npm test\n  format: npx prettier --write\n${extra}`,
		});
	const added = planChanges(sdlc(), harness("checks: [test]\n"), [], NO_FILES);
	expect(added.security).toEqual([
		"+ command format runs on this machine: npx prettier --write",
		"+ command test runs on this machine: npm test",
	]);
	expect(added.settings).toContain("+ checks: test");
	const lessGuarded = planChanges(
		harness("checks: [test]\n"),
		harness(""),
		[],
		NO_FILES,
	);
	expect(lessGuarded.security).toEqual(["- checks no longer run test"]);
	const changed = planChanges(
		harness(""),
		sdlc({
			"factory.yaml": `${factoryYaml}commands:\n  test: npm test -- --run\n  format: npx prettier --write\n`,
		}),
		[],
		NO_FILES,
	);
	expect(changed.security).toEqual([
		"~ command test: npm test → npm test -- --run",
	]);
});

it("flags every env and secrets change as a security change, never a secret's value", () => {
	const factoryYaml = sdlcFiles()["factory.yaml"] as string;
	const withEnv = (extra: string) =>
		sdlc({ "factory.yaml": `${factoryYaml}${extra}` });
	const added = planChanges(
		sdlc(),
		withEnv("env:\n  NODE_ENV: test\nsecrets: [DATABASE_URL]\n"),
		[],
		NO_FILES,
	);
	expect(added.security).toEqual([
		"+ env NODE_ENV=test, for setup, commands and agents",
		"+ secret DATABASE_URL, from this machine, for setup and commands",
	]);
	const changed = planChanges(
		withEnv("env:\n  NODE_ENV: test\nsecrets: [DATABASE_URL]\n"),
		withEnv("env:\n  NODE_ENV: ci\n"),
		[],
		NO_FILES,
	);
	expect(changed.security).toEqual([
		"~ env NODE_ENV: test → ci",
		"- secret DATABASE_URL",
	]);
	expect(
		planChanges(withEnv("env:\n  NODE_ENV: ci\n"), sdlc(), [], NO_FILES)
			.security,
	).toEqual(["- env NODE_ENV"]);
});

it("shows a time zone change, which moves every schedule", () => {
	const factoryYaml = sdlcFiles()["factory.yaml"] as string;
	const plan = planChanges(
		sdlc(),
		sdlc({ "factory.yaml": `${factoryYaml}timezone: Europe/Paris\n` }),
		[],
		NO_FILES,
	);
	expect(plan.settings).toContain(
		"+ timezone Europe/Paris: schedules read in this time zone",
	);
});

it("shows every changed file the plan does not describe, and never the ones it does", () => {
	const before = sdlcFiles();
	const after = {
		...before,
		"README.md": "notes\n",
		[REVIEW]: reviewWith(
			"when: [pull_request.opened, pull_request.updated]\nagent: reviewer\ncan:\n  - add_comment\n  - request_changes\n  - add_labels: [needs-human]",
		),
		"skills/repository-conventions/setup.sh": "echo hi\n",
	};
	const plan = planChanges(load(before), load(after), [], { before, after });
	expect(plan.security).toEqual([
		"+ skill file skills/repository-conventions/setup.sh",
	]);
	expect(plan.settings).toEqual(["+ file README.md"]);
	expect(plan.automations).toEqual([
		"~ review-pull-requests: instructions changed",
	]);
});

it("names every changed field of an agent, an automation and the factory", () => {
	const files = sdlcFiles();
	const implementer = files["agents/implementer/agent.md"] as string;
	const after = sdlc({
		"agents/implementer/agent.md": implementer
			.replace(/description: .*/, "description: Implements")
			.replace("model: opus", "model: sonnet")
			.replace("tools: [read, edit, shell]", "tools: [read, edit]")
			.replace("# Implementation", "# Build"),
		"agents/implementer/skills/x/SKILL.md":
			"---\nname: x\ndescription: X.\n---\nX.\n",
		"automations/implement-ready-issues/automation.md":
			"---\nwhen:\n  issue.labeled: { labels: [ready-for-agent] }\nagent: rework\nconcurrency: repository\nfrom: anyone\ncan: [add_comment]\n---\nDo it.\n",
	});
	const plan = planChanges(sdlc(), after, [], NO_FILES);
	expect(plan.agents).toEqual([
		"~ implementer: description changed; model opus → sonnet; tools read, edit, shell → read, edit; skills testing-standards → testing-standards, x; instructions changed",
	]);
	expect(plan.automations).toEqual([
		"~ implement-ready-issues: agent implementer → rework; can create_pull_request, add_comment, remove_labels (ready-for-agent), add_labels (needs-info) → add_comment; concurrency issue → repository; from maintainers → anyone; instructions changed",
	]);

	const factory = (yaml: string) =>
		load({
			"factory.yaml": `repository: acme/app\nmaintainers: [alice]\n${yaml}`,
			"agents/worker/agent.md": "---\ndescription: Does things\n---\nDo.\n",
		});
	const plain = factory("name: F\n");
	const full = factory("name: G\ndescription: New\nmodel: opus\n");
	expect(planChanges(plain, full, [], NO_FILES).settings).toEqual([
		"~ name: F → G",
		"~ description: none → New",
		"~ model: sonnet → opus",
	]);
	expect(planChanges(full, plain, [], NO_FILES).settings).toEqual([
		"~ name: G → F",
		"~ description: New → none",
		"~ model: opus → sonnet",
	]);
});

it("keeps every section of a plan that touches every topic, and every line, in one order", () => {
	const files = sdlcFiles();
	const yaml = files["factory.yaml"] as string;
	const before = load({
		...files,
		"factory.yaml": `${yaml.replace("usd_per_day: 30", "usd_per_day: 50")}commands:\n  lint: npm run lint\nchecks: [lint]\nmcp:\n  old:\n    url: https://old.dev/mcp\nwebhooks:\n  old-hook:\n    signature: standard\nintegrations:\n  linear:\n    team: ENG\nwiki: true\n`,
	});
	const changed = {
		...files,
		"factory.yaml": `${yaml
			.replace("name: Task app factory", "name: Task factory")
			.replace("acme/task-app", "acme/app")
			.replace("usd_per_run: 5", "usd_per_run: 8")
			.replace(
				"maintainers: [ada]",
				"maintainers: [ada, bob]",
			)}setup: pnpm install\ncommands:\n  test: npm test\nenv:\n  NODE_ENV: test\nsecrets: [API_KEY]\nmcp:\n  docs:\n    url: https://mcp.acme.dev/mcp\ntimezone: UTC\nsignature: false\nwebhooks:\n  deploy:\n    signature: standard\nintegrations:\n  slack:\n    channel: factory\nanswer_mentions: false\n`,
		"agents/reviewer/agent.md":
			"---\ndescription: Reviews pull requests\ntools: [read, web]\n---\nReview.\n",
		"skills/repository-conventions/SKILL.md":
			"---\nname: repository-conventions\ndescription: New.\n---\nNew.\n",
		"README.md": "# The factory\n",
	};
	const plan = planChanges(before, load(changed), [], {
		before: files,
		after: changed,
	});
	expect(formatPlan(plan).split("\n")).toEqual([
		"Security changes (read these first)",
		"  ~ repository: acme/task-app → acme/app",
		"  ~ limit usd_per_run raised: 5 → 8",
		"  + setup runs on this machine before every agent: pnpm install",
		"  + command test runs on this machine: npm test",
		"  - checks no longer run lint",
		"  + env NODE_ENV=test, for setup, commands and agents",
		"  + secret API_KEY, from this machine, for setup and commands",
		"  + mcp server docs, at https://mcp.acme.dev/mcp",
		'  + webhook deploy, signed (standard); a signed request can now start automations ("openfabriq connect webhook deploy")',
		'  + slack: channel #factory; people in the channel can now start automations, through the relay ("openfabriq connect slack")',
		"  + maintainer bob can now start automations",
		"  + agent reviewer can now use web",
		"  ~ skill file skills/repository-conventions/SKILL.md changed",
		"  - answer-mentions: off",
		"",
		"Agents",
		"  ~ reviewer: description changed; model opus → default; tools read, shell → read, web; instructions changed",
		"",
		"Factory settings",
		"  ~ name: Task app factory → Task factory",
		"  ~ limit usd_per_day lowered: 50 → 30",
		"  - command lint",
		"  - mcp server old",
		"  + timezone UTC: schedules read in this time zone",
		"  - signature: what the factory writes on GitHub no longer says openfabriq wrote it",
		'  - webhook old-hook; the relay accepts it until "openfabriq connect webhook old-hook --remove"',
		"  - linear: team ENG",
		"  + file README.md",
		"  - wiki: off",
		"",
		"Labels to create on GitHub",
		"  + needs-human",
		"  + needs-info",
		"  + needs-investigation",
		"  + openfabriq:working",
		"  + ready-for-agent",
		"",
		"Plan: 0 to add, 1 to change, 0 to remove, 5 labels to create.",
	]);
});

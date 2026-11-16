import { describe, expect, it } from "vitest";
import { withAnswerMentions } from "../src/factory/answer-mentions.js";
import { loadFactory } from "../src/factory/load.js";
import {
	type FactoryEvent,
	matchingAutomations,
	startedByMaintainer,
} from "../src/match.js";
import { example } from "./helpers.js";

// The migration templates run from the plan to the switch with a person at the plan's merge, at each
// reviewed pull request's merge and on needs-human: each step below is the event the step before it produces.

const ENGINE = "openfabriq-bot";
const TEMPLATES = [
	{
		name: "26-webflow-to-astro",
		discover: "migration:discover",
		plan: "plan-migration",
		folder: "migration",
		builder: "astro-builder",
		reviewer: "parity-reviewer",
		built: ["src/pages/blog/[slug].astro", "evidence/12/blog-new-desktop.png"],
	},
	{
		name: "27-framer-to-astro",
		discover: "migration:discover",
		plan: "plan-migration",
		folder: "migration",
		builder: "astro-builder",
		reviewer: "parity-reviewer",
		built: ["src/pages/blog/[slug].astro", "evidence/12/blog-new-desktop.png"],
	},
];

describe.each(TEMPLATES)("$name", (t) => {
	const loaded = loadFactory(example(t.name)).factory;
	if (!loaded) throw new Error(`${t.name} should load`);
	const factory = withAnswerMentions(loaded);
	const maintainer = factory.maintainers[0] ?? "";
	const event = (e: Partial<FactoryEvent>): FactoryEvent => ({
		key: "k",
		event: "issue.opened",
		isPullRequest: false,
		actor: maintainer,
		at: "2026-11-11T00:00:00Z",
		...e,
	});
	const starts = (e: FactoryEvent) =>
		matchingAutomations(factory, e, [ENGINE]).map((a) => a.name);
	const plan = [
		`${t.folder}/inventory.md`,
		`${t.folder}/decisions.md`,
		`${t.folder}/tickets/T01-foundation.md`,
	];
	const ticket = [...t.built, `${t.folder}/tickets/T02-blog.md`];

	it("a maintainer's label starts the survey and the plan", () => {
		expect(
			starts(event({ event: "issue.labeled", number: 1, label: t.discover })),
		).toEqual([t.plan]);
	});

	it("the plan's pull request waits for a maintainer: no review runs on it", () => {
		const opened = event({
			event: "pull_request.opened",
			number: 2,
			isPullRequest: true,
			actor: ENGINE,
			openedBy: "planner",
			files: plan,
		});
		expect(starts(opened)).toEqual([]);
	});

	it("only a maintainer's @openfabriq on the plan sends the planner back: people discuss it freely", () => {
		const comment = (text: string) =>
			starts(
				event({
					event: "pull_request.commented",
					number: 2,
					isPullRequest: true,
					openedBy: "planner",
					answeredBy: "planner",
					text,
				}),
			);
		expect(comment("@openfabriq drop the blog's tag pages")).toEqual([
			"answer-mentions-planner",
		]);
		expect(
			comment("I'd rather keep the tag pages, what do you think?"),
		).toEqual([]);
	});

	it("each push to the default branch, a person's merge or the engine's, opens the next tickets", () => {
		for (const actor of [maintainer, ENGINE]) {
			const pushed = event({
				event: "default_branch.updated",
				actor,
				commits: "a..b",
			});
			expect(starts(pushed)).toEqual(["open-tickets"]);
			// Its writes count as a maintainer's: the labels it puts start the builder.
			expect(startedByMaintainer(factory, pushed, [ENGINE])).toBe(true);
		}
	});

	it("ready-for-agent, put by the engine when it opens a ticket, starts the builder", () => {
		expect(
			starts(
				event({
					event: "issue.labeled",
					number: 3,
					label: "ready-for-agent",
					actor: ENGINE,
				}),
			),
		).toEqual(["build-tickets"]);
	});

	it("the builder's change is reviewed before its pull request opens, and a person merges it", () => {
		for (const name of ["build-tickets", "sync-content"])
			expect(factory.automations[name]?.reviewedBy).toBe(t.reviewer);
		// Nothing runs on the factory's pull request on GitHub: the review happened on the machine.
		const pull = {
			number: 4,
			isPullRequest: true,
			actor: ENGINE,
			openedBy: t.builder,
			files: ticket,
		};
		for (const name of [
			"pull_request.opened",
			"pull_request.updated",
			"pull_request.changes_requested",
		] as const)
			expect(starts(event({ ...pull, event: name }))).toEqual([]);
		const merges = Object.values(factory.automations).filter((a) =>
			a.can.some((c) => c.action === "merge_pull_request"),
		);
		expect(merges).toEqual([]);
	});
});

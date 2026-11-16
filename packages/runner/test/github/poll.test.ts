import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Factory,
	type FactoryEvent,
	loadFactory,
	withWiki,
} from "@openfabriq/core";
import { beforeEach, expect, it } from "vitest";
import {
	cursorPath,
	engineMerges,
	rememberMerge,
	SEEN_KEPT,
	writeCursor,
} from "../../src/engine/cursors.js";
import { readJsonIfExists } from "../../src/files.js";
import type { GitHub, OpenPull } from "../../src/github/github.js";
import { type Cursor, pollGitHub } from "../../src/github/poll.js";
import type { IssueItem, TimelineItem } from "../../src/github/timeline.js";

const REPO = "acme/app";
const factory = loadFactory({
	"factory.yaml": "name: F\nrepository: acme/app\nmaintainers: [alice]\n",
	"agents/worker/agent.md": "---\ndescription: Works\n---\nWork.\n",
	"automations/run/automation.md":
		"---\nwhen: [pull_request.conflicted, default_branch.updated]\nagent: worker\ncan: [push_to_pull_request]\n---\nGo.\n",
}).factory as Factory;

let pulls: OpenPull[];
let head: string;
/** The heads of base branches other than main. */
let bases: Record<string, string>;
let items: IssueItem[];
let timelines: Record<number, TimelineItem[]>;
let disabled: number[];

const github = {
	openPulls: async () => pulls,
	branchHead: async (_repo: string, branch: string) => bases[branch] ?? head,
	issuesUpdatedSince: async () => items,
	timeline: async (_repo: string, number: number) => timelines[number] ?? [],
	commitAuthor: async () => "alice",
	disableAutoMerge: async (_repo: string, number: number) => {
		disabled.push(number);
	},
	changedFiles: async () => [],
	commitFiles: async () => [],
} as unknown as GitHub;

let moves = 0;
/** One poll as the engine makes it: the events are queued, then the cursor is written. */
async function poll(
	gh: GitHub = github,
	f: Factory = factory,
): Promise<FactoryEvent[]> {
	const polled = await pollGitHub(REPO, f, "main", {
		github: gh,
		now: () => new Date("2026-11-06T22:00:00Z"),
		saved: readJsonIfExists<Cursor>(cursorPath(REPO)),
		engineMerges: () => engineMerges(REPO),
	});
	writeCursor(cursorPath(REPO), polled.cursor);
	if (polled.headMoved) moves++;
	return polled.events;
}

const pull = (over: Partial<OpenPull> = {}): OpenPull => ({
	number: 5,
	sha: "head1",
	author: "alice",
	checks: [],
	mergeable: "MERGEABLE",
	base: "main",
	...over,
});

beforeEach(() => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-poll-"));
	pulls = [pull()];
	head = "main1";
	bases = {};
	items = [];
	timelines = {};
	disabled = [];
	moves = 0;
});

const cursor = () => readJsonIfExists<unknown>(cursorPath(REPO));
const failure = {
	name: "ci",
	status: "COMPLETED",
	conclusion: "FAILURE",
	detailsUrl: "https://ci/1",
};
const event = (over: Partial<FactoryEvent>): FactoryEvent => ({
	key: "",
	event: "pull_request.updated",
	number: 5,
	isPullRequest: true,
	actor: "alice",
	at: "2026-11-06T22:00:00.000Z",
	...over,
});

/** The GitHub calls made, in order, with their arguments after the repository. */
function recording(gh: GitHub, calls: string[]): GitHub {
	return new Proxy(gh, {
		get(target, name) {
			const value = target[name as keyof GitHub];
			if (typeof value !== "function") return value;
			return (...args: unknown[]) => {
				calls.push([String(name), ...args.slice(1)].join(" "));
				return (value as (...a: unknown[]) => unknown)(...args);
			};
		},
	});
}

it("notes where things are on the first start, and counts only what happens after", async () => {
	pulls = [
		pull({ number: 5, checks: [failure] }),
		pull({ number: 6, mergeable: "CONFLICTING" }),
	];
	expect(await poll()).toEqual([]);
	expect(cursor()).toEqual({
		since: "2026-11-06T22:00:00.000Z",
		seen: ["checks:5:head1", "conflict:6:head1:main1"],
		heads: { 5: "head1", 6: "head1" },
		branch: "main1",
	});
	expect(await poll()).toEqual([]);
	expect(cursor()).toEqual({
		since: "2026-11-06T21:58:00.000Z",
		seen: ["checks:5:head1", "conflict:6:head1:main1"],
		heads: { 5: "head1", 6: "head1" },
		branch: "main1",
	});
	expect(moves).toBe(0);
});

it("starts once on a pull request whose checks failed, and again on its next push", async () => {
	await poll();
	pulls = [pull({ checks: [{ ...failure, status: "IN_PROGRESS" }] })];
	expect(await poll()).toEqual([]);
	pulls = [pull({ checks: [failure] })];
	expect(await poll()).toEqual([
		event({ key: "checks:5:head1", event: "pull_request.checks_failed" }),
	]);
	expect(await poll()).toEqual([]);
	pulls = [pull({ sha: "head2", checks: [failure] })];
	expect(await poll()).toEqual([
		event({ key: "push:5:head2", event: "pull_request.updated" }),
		event({ key: "checks:5:head2", event: "pull_request.checks_failed" }),
	]);
});

it("says a pull request comes from a run no maintainer started", async () => {
	pulls = [pull({ fromUntrustedRun: true })];
	await poll();
	pulls = [pull({ sha: "head2", fromUntrustedRun: true, checks: [failure] })];
	expect(await poll()).toEqual([
		event({ key: "push:5:head2", fromUntrustedRun: true }),
		event({
			key: "checks:5:head2",
			event: "pull_request.checks_failed",
			fromUntrustedRun: true,
		}),
	]);
});

it("starts on a conflict again after a new merge on its own base, not on the default branch", async () => {
	bases = { release: "rel1" };
	pulls = [pull({ base: "release", mergeable: "CONFLICTING" })];
	await poll();
	expect(await poll()).toEqual([]);
	head = "main2";
	expect((await poll()).map((e) => e.key)).toEqual(["branch:main2"]);
	bases = { release: "rel2" };
	expect(await poll()).toEqual([
		event({ key: "conflict:5:head1:rel2", event: "pull_request.conflicted" }),
	]);
});

it("reads an older cursor, without the branch: the checks failing now are not news", async () => {
	writeCursor(cursorPath(REPO), {
		since: "2026-11-06T21:00:00.000Z",
		seen: ["old"],
		heads: { 5: "head1" },
	});
	pulls = [pull({ checks: [failure] })];
	expect(await poll()).toEqual([]);
	expect(cursor()).toEqual({
		since: "2026-11-06T21:58:00.000Z",
		seen: ["old", "checks:5:head1"],
		heads: { 5: "head1" },
		branch: "main1",
	});
	expect(moves).toBe(0);
	head = "main2";
	expect(await poll()).toEqual([
		expect.objectContaining({
			event: "default_branch.updated",
			commits: "main1..main2",
		}),
	]);
});

it("keeps the cursor when a read fails, so the next poll reads the same events again", async () => {
	await poll();
	const before = cursor();
	pulls = [pull({ sha: "head2" })];
	head = "main2";
	const offline = {
		...github,
		commitAuthor: async () => {
			throw new Error("gh: timeout");
		},
	} as GitHub;
	await expect(poll(offline)).rejects.toThrow("gh: timeout");
	expect(cursor()).toEqual(before);
	expect(moves).toBe(0);
	expect((await poll()).map((e) => e.key)).toEqual([
		"push:5:head2",
		"branch:main2",
	]);
	expect(moves).toBe(1);
});

it("keeps the last SEEN_KEPT keys of the events seen", async () => {
	const old = Array.from({ length: SEEN_KEPT }, (_, i) => `old:${i}`);
	writeCursor(cursorPath(REPO), {
		since: "2026-11-06T21:00:00.000Z",
		seen: old,
		heads: { 5: "head1" },
		branch: "main1",
	});
	pulls = [pull({ sha: "head2" })];
	await poll();
	const { seen } = cursor() as { seen: string[] };
	expect(seen).toHaveLength(SEEN_KEPT);
	expect(seen[0]).toBe("old:1");
	expect(seen.at(-1)).toBe("push:5:head2");
});

it("reads everything in this order, then queues the events sorted by time, then writes the cursor", async () => {
	const filtered = withWiki(
		loadFactory({
			"factory.yaml":
				"name: F\nrepository: acme/app\nmaintainers: [alice]\nwiki:\n  refresh: after_merge\n",
			"agents/worker/agent.md": "---\ndescription: Works\n---\nWork.\n",
			"automations/run/automation.md":
				'---\nwhen:\n  pull_request.updated: { ignore_paths: ["docs/**"] }\nagent: worker\ncan: [add_comment]\n---\nGo.\n',
		}).factory as Factory,
	);
	bases = { release: "rel1" };
	pulls = [
		pull({ number: 5, autoMerge: true }),
		pull({ number: 6, base: "release", mergeable: "CONFLICTING" }),
	];
	await poll(github, filtered);
	rememberMerge(REPO, 5);
	pulls = [
		pull({ number: 5, sha: "head2", autoMerge: true }),
		pull({ number: 6, base: "release", mergeable: "CONFLICTING" }),
	];
	bases = { release: "rel2" };
	head = "main2";
	items = [
		{ number: 9, created_at: "2026-10-01T00:00:00Z", user: { login: "bob" } },
	];
	timelines = {
		9: [
			{
				event: "labeled",
				id: 1,
				created_at: "2026-11-06T22:00:30Z",
				actor: { login: "bob" },
				label: { name: "bug" },
			},
		],
	};
	const calls: string[] = [];
	const queued = await poll(recording(github, calls), filtered);
	expect(calls).toEqual([
		"openPulls",
		"branchHead main",
		"branchHead release",
		"issuesUpdatedSince 2026-11-06T22:00:00.000Z",
		"timeline 9",
		"disableAutoMerge 5",
		"commitAuthor main2",
		"changedFiles 5",
		"commitFiles main1..main2",
	]);
	expect(disabled).toEqual([5]);
	expect(queued).toEqual([
		event({ key: "push:5:head2", files: [] }),
		event({
			key: "conflict:6:head1:rel2",
			event: "pull_request.conflicted",
			number: 6,
		}),
		{
			key: "branch:main2",
			event: "default_branch.updated",
			isPullRequest: false,
			actor: "alice",
			commits: "main1..main2",
			at: "2026-11-06T22:00:00.000Z",
			files: [],
		},
		{
			key: "labeled:1",
			event: "issue.labeled",
			number: 9,
			isPullRequest: false,
			actor: "bob",
			at: "2026-11-06T22:00:30Z",
			label: "bug",
		},
	]);
	expect(cursor()).toEqual({
		since: "2026-11-06T21:58:00.000Z",
		seen: [
			"conflict:6:head1:rel1",
			"push:5:head2",
			"conflict:6:head1:rel2",
			"branch:main2",
			"labeled:1",
		],
		heads: { 5: "head2", 6: "head1" },
		branch: "main2",
	});
	expect(moves).toBe(1);
});

it("starts once on a pull request in conflict, and again after a new merge on its base", async () => {
	await poll(); // the first poll only notes where things are
	pulls = [pull({ mergeable: "UNKNOWN" })];
	expect(await poll()).toEqual([]);
	pulls = [pull({ mergeable: "CONFLICTING" })];
	expect(await poll()).toEqual([
		{
			key: "conflict:5:head1:main1",
			event: "pull_request.conflicted",
			number: 5,
			isPullRequest: true,
			actor: "alice",
			at: "2026-11-06T22:00:00.000Z",
		},
	]);
	expect(await poll()).toEqual([]);
	head = "main2"; // a new merge on main
	const keys = (await poll()).map((e) => e.key);
	expect(keys).toContain("conflict:5:head1:main2");
});

it("starts default_branch.updated on the engine's own merge too, so a factory goes on from it", async () => {
	await poll();
	moves = 0;
	rememberMerge(REPO, 7);
	head = "main2";
	expect(await poll()).toEqual([
		expect.objectContaining({
			event: "default_branch.updated",
			commits: "main1..main2",
		}),
	]);
	expect(moves).toBe(1);
	expect(await poll()).toEqual([]);
	expect(cursor()).toMatchObject({ branch: "main2" });
});

it("reads an older cursor that kept the engine's own merge apart: its commits start once", async () => {
	await poll();
	writeCursor(cursorPath(REPO), {
		...(cursor() as Cursor),
		branch: "main1",
		mergedHead: "main2",
	});
	head = "main2";
	expect(await poll()).toEqual([
		expect.objectContaining({ commits: "main1..main2" }),
	]);
	expect(cursor()).not.toHaveProperty("mergedHead");
	expect(await poll()).toEqual([]);
});

it("turns its own auto-merge off when new commits arrive, so they wait for a new review", async () => {
	pulls = [
		pull({ number: 5, autoMerge: true }),
		pull({ number: 6, autoMerge: true }),
	];
	await poll();
	rememberMerge(REPO, 5); // only #5's auto-merge is the engine's
	pulls = [
		pull({ number: 5, sha: "head2", autoMerge: true }),
		pull({ number: 6, sha: "head2", autoMerge: true }),
	];
	const events = await poll();
	expect(disabled).toEqual([5]);
	expect(events.map((e) => e.event)).toEqual([
		"pull_request.updated",
		"pull_request.updated",
	]);
});

it("tries again at the next poll to turn off an auto-merge GitHub kept, and reads the rest meanwhile", async () => {
	pulls = [pull({ number: 5, autoMerge: true }), pull({ number: 6 })];
	await poll();
	rememberMerge(REPO, 5);
	pulls = [
		pull({ number: 5, sha: "head2", autoMerge: true }),
		pull({ number: 6, sha: "head2" }),
	];
	let failing = true;
	const flaky = {
		...github,
		disableAutoMerge: async (repo: string, number: number) => {
			if (failing) throw new Error("gh: HTTP 502");
			return github.disableAutoMerge(repo, number);
		},
	} as GitHub;
	const polled = await pollGitHub(REPO, factory, "main", {
		github: flaky,
		now: () => new Date("2026-11-06T22:00:00Z"),
		saved: readJsonIfExists<Cursor>(cursorPath(REPO)),
		engineMerges: () => engineMerges(REPO),
	});
	writeCursor(cursorPath(REPO), polled.cursor);
	// The other pull request's push is read; #5's push too, once.
	expect(polled.events.map((e) => e.key)).toEqual([
		"push:5:head2",
		"push:6:head2",
	]);
	expect(polled.autoMergeStillOn).toEqual([
		{ number: 5, reason: "gh: HTTP 502" },
	]);
	expect(disabled).toEqual([]);
	failing = false;
	expect(await poll(flaky)).toEqual([]);
	expect(disabled).toEqual([5]);
	expect(await poll(flaky)).toEqual([]);
	expect(disabled).toEqual([5]);
});

it("reads the files of new commits for the wiki after each merge, and only then", async () => {
	const asked: string[] = [];
	const wikiFactory = withWiki(
		loadFactory({
			"factory.yaml":
				"name: F\nrepository: acme/app\nmaintainers: [alice]\nwiki:\n  refresh: after_merge\n",
		}).factory as Factory,
	);
	const reading = {
		...github,
		commitFiles: async (_repo: string, commits: string) => {
			asked.push(commits);
			return ["wiki/index.md"];
		},
	} as GitHub;
	const queued: FactoryEvent[] = [];
	const once = async (f: Factory) => queued.push(...(await poll(reading, f)));
	await once(wikiFactory);
	head = "main2";
	await once(wikiFactory);
	expect(asked).toEqual(["main1..main2"]);
	expect(queued).toEqual([
		expect.objectContaining({
			commits: "main1..main2",
			files: ["wiki/index.md"],
		}),
	]);
	head = "main3";
	await once(factory);
	expect(asked).toEqual(["main1..main2"]);
});

it("queues the merge without its files when GitHub cannot compare the commits", async () => {
	const wikiFactory = withWiki(
		loadFactory({
			"factory.yaml":
				"name: F\nrepository: acme/app\nmaintainers: [alice]\nwiki:\n  refresh: after_merge\n",
		}).factory as Factory,
	);
	const failing = {
		...github,
		commitFiles: async () => {
			throw new Error("HTTP 404: Not Found");
		},
	} as GitHub;
	const queued: FactoryEvent[] = [];
	const once = async () => queued.push(...(await poll(failing, wikiFactory)));
	await once();
	head = "main2";
	await once();
	expect(queued).toEqual([
		expect.objectContaining({
			event: "default_branch.updated",
			commits: "main1..main2",
		}),
	]);
	expect(queued[0]?.files).toBeUndefined();
});

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import {
	cronWords,
	type Factory,
	type FactoryFiles,
	factoryLabels,
	formatPlan,
	loadFactory,
	nextRun,
	planChanges,
} from "@openfabriq/core";
import { z } from "zod";
import { usesRelay } from "../sources/relay.js";
import { type RunRecord, readRuns } from "../state/journal.js";
import { projectDir, readAppliedFiles } from "../state/projects.js";
import { readSecrets, type Secrets } from "../state/secrets.js";
import {
	MAX_SEARCH,
	readWiki,
	searchWiki,
	WIKI_NOT_FETCHED,
	WIKI_OFF,
	wikiPage,
} from "../workspace/wiki.js";
import { condenseTranscript, cut } from "./transcript.js";

/** The name of the chat's MCP server: its tools are mcp__openfabriq__<name>. */

export const SERVER = "openfabriq";
const text = (data: unknown) => ({
	content: [
		{
			type: "text" as const,
			text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
		},
	],
});

/** A tool of the chat's MCP server. */
export type ChatTool = NonNullable<
	Parameters<typeof createSdkMcpServer>[0]["tools"]
>[number];

/** A read-only tool whose answer is data, for the tools the app adds to the chat (metrics, board). */
export const readTool = <Shape extends z.ZodRawShape>(
	name: string,
	description: string,
	shape: Shape,
	read: (args: z.infer<z.ZodObject<Shape>>) => unknown,
): ChatTool =>
	tool(name, description, shape, async (args) =>
		text(await read(args as z.infer<z.ZodObject<Shape>>)),
	);

const SOURCES = ["github", "slack", "linear", "sentry", "webhook"] as const;

/** "#12", "ENG-123", "#factory": how a person names what a run was about. */
const subjectOf = (r: RunRecord) =>
	r.source?.label ?? (r.number === undefined ? undefined : `#${r.number}`);

/** The applied files with a proposal's changes: a path with null is deleted. */
function proposed(
	before: FactoryFiles,
	changes: Record<string, string | null>,
): FactoryFiles {
	const after = { ...before };
	for (const [path, content] of Object.entries(changes)) {
		const key = path.replace(/^(\.\/)?openfabriq\//, "");
		if (content === null) delete after[key];
		else after[key] = content;
	}
	return after;
}

/** Each integration the factory uses, and whether this machine has what it needs; never a value. */
function connections(factory: Factory, s: Secrets) {
	const relay = !!s.relay?.url && !!s.relay.token;
	const needsRelay = usesRelay(factory);
	const state = (ok: boolean, command: string) =>
		ok ? { connected: true } : { connected: false, command };
	const unused = (["slack", "linear", "sentry", "webhooks"] as const).filter(
		(name) => !factory[name],
	);
	return {
		github:
			"read with the gh CLI every minute: needs neither the relay nor a connection",
		...(unused.length > 0 ? { notUsedByTheFactory: unused } : {}),
		...(factory.slack
			? {
					slack: {
						channel: factory.slack.channel,
						...state(!!s.slack?.bot_token, "openfabriq connect slack"),
					},
				}
			: {}),
		...(factory.linear
			? {
					linear: {
						team: factory.linear.team,
						// shortcut: whether the app is installed is only known to the relay; asking it here would block the chat.
						...state(relay, "openfabriq connect linear"),
					},
				}
			: {}),
		...(factory.sentry
			? {
					sentry: {
						project: `${factory.sentry.organization}/${factory.sentry.project}`,
						...state(!!s.sentry?.token, "openfabriq connect sentry"),
					},
				}
			: {}),
		...(needsRelay ? { relay: state(relay, "openfabriq connect relay") } : {}),
		...(factory.webhooks
			? {
					webhooks: Object.keys(factory.webhooks).map((name) => ({
						name,
						command: `openfabriq connect webhook ${name}`,
					})),
				}
			: {}),
	};
}

/** Read-only tools on the project's factory and runs; `extra` are the app's. */
export function chatTools(
	repository: string,
	factory: Factory,
	extra: ChatTool[] = [],
) {
	const runsDir = join(projectDir(repository), "runs");
	const tools: ChatTool[] = [
		tool(
			"factory_overview",
			"The factory applied to this project: its agents, its automations (when they start, what they can do), its limits. The full files are in the factory folder.",
			{},
			// The instructions are long; they stay in the factory folder.
			async () =>
				text(
					JSON.stringify(
						factory,
						(key, value) => (key === "instructions" ? undefined : value),
						2,
					),
				),
		),
		tool(
			"list_runs",
			"The project's runs, latest first. Filters: the agent, the status, where the run came from, what it was about, and since when.",
			{
				agent: z.string().optional(),
				status: z
					.enum(["queued", "running", "succeeded", "failed", "skipped"])
					.optional(),
				source: z.enum(SOURCES).optional(),
				subject: z
					.string()
					.optional()
					.describe('What the run was about: "#12", "ENG-123", "#factory"'),
				since: z
					.string()
					.optional()
					.describe("Queued at or after this ISO date or time: 2026-11-01"),
				limit: z.number().int().min(1).max(200).default(20),
			},
			async ({ agent, status, source, subject, since, limit }) =>
				text(
					readRuns(repository)
						.filter(
							(r) =>
								(!agent || r.agent === agent) &&
								(!status || r.status === status) &&
								(!source || (r.source?.kind ?? "github") === source) &&
								(!subject || subjectOf(r) === subject) &&
								(!since || r.queuedAt >= since),
						)
						.slice(0, limit),
				),
		),
		tool(
			"read_run",
			"One run: its record, the prompt the agent got, and what it did.",
			{ id: z.string() },
			async ({ id }) => {
				const runs = readRuns(repository);
				const run = runs.find((r) => r.id === id);
				if (!run)
					return { ...text(`No run ${id} in this project.`), isError: true };
				const file = (name: string) => {
					const path = join(runsDir, run.id, name);
					return existsSync(path) ? readFileSync(path, "utf8") : "";
				};
				// A run interrupted by a stop is queued again once, with the same queuedAt.
				const again = run.reason?.startsWith("interrupted:")
					? runs.find(
							(r) =>
								r.id !== run.id &&
								r.queuedAt === run.queuedAt &&
								r.automation === run.automation &&
								r.number === run.number,
						)
					: undefined;
				return text(
					[
						JSON.stringify(run, null, 2),
						...(again
							? [
									`## Queued again after the stop\nThe engine ran it again: run ${again.id}, ${again.status}.`,
								]
							: []),
						`## Prompt\n${cut(file("prompt.md"), 8000)}`,
						`## What the agent did\n${condenseTranscript(file("transcript.jsonl"))}`,
					].join("\n\n"),
				);
			},
		),
		tool(
			"schedules",
			"The scheduled automations: when they run, in words, in the factory's time zone; their next run and their latest one. A time missed while the machine slept runs once when it wakes.",
			{},
			async () => {
				const runs = readRuns(repository);
				const now = new Date();
				return text(
					Object.values(factory.automations).flatMap((a) =>
						a.when.flatMap((t) => {
							if (!t.cron) return [];
							const latest = runs.find(
								(r) => r.automation === a.name && r.event === "schedule",
							);
							return [
								{
									automation: a.name,
									agent: a.agent,
									cron: t.cron,
									words: cronWords(t.cron),
									timezone: factory.timezone ?? "the machine's",
									next: nextRun(t.cron, now, factory.timezone)?.toISOString(),
									...(latest
										? {
												latest: {
													id: latest.id,
													status: latest.status,
													at: latest.scheduledFor ?? latest.queuedAt,
												},
											}
										: {}),
								},
							];
						}),
					),
				);
			},
		),
		tool(
			"read_wiki",
			"The project's wiki, a map of its code kept by the engine, at the default branch: without arguments, its folder and its pages; with page (like areas/payments.md), that page; with search, the lines that contain these words. Empty when the wiki is off or not generated yet.",
			{
				page: z.string().optional(),
				search: z.string().max(MAX_SEARCH).optional(),
			},
			async ({ page, search }) => {
				if (search !== undefined)
					return text(await searchWiki(repository, search));
				if (page === undefined)
					return text((await readWiki(repository)) ?? WIKI_OFF);
				const found = await wikiPage(repository, page);
				if ("text" in found) return text(found.text);
				const why =
					found.missing === "off"
						? WIKI_OFF
						: found.missing === "not fetched"
							? WIKI_NOT_FETCHED
							: `No page ${page} in the wiki.`;
				return { ...text(why), isError: true };
			},
		),
		tool(
			"connections",
			"The integrations the factory uses (Slack, Linear, Sentry, the relay, webhooks) and whether this machine has what they need, with the command that connects one; those the factory does not use; how GitHub is read. Says yes or no, never a secret.",
			{},
			async () => text(connections(factory, readSecrets())),
		),
		tool(
			"check_factory_change",
			"Checks a change you propose to the factory, without writing anything: give each file of openfabriq/ it adds or changes with its full content (path like agents/reviewer/agent.md), and null for a file it deletes. Returns what validate says, then what apply would change, security changes first. Labels: those the applied factory does not use yet.",
			{ files: z.record(z.string(), z.string().nullable()) },
			async ({ files }) => {
				const before = readAppliedFiles(repository) ?? {};
				const after = proposed(before, files);
				const { factory: next, problems } = loadFactory(after);
				const lines = problems.map(
					(p) => `${p.level === "error" ? "✗" : "!"} ${p.file}: ${p.message}`,
				);
				if (!next)
					return text(
						[...lines, "Not valid: fix the errors above."].join("\n"),
					);
				const plan = planChanges(factory, next, factoryLabels(factory), {
					before,
					after,
				});
				return text([...lines, "✓ valid", formatPlan(plan)].join("\n\n"));
			},
		),
		...extra,
	];
	return {
		server: createSdkMcpServer({ name: SERVER, tools }),
		names: tools.map((t) => `mcp__${SERVER}__${t.name}`),
		tools,
	};
}

import { resourceFolder } from "@openfabriq/core";
import {
	BookOpen,
	Bot,
	FilePen,
	Folder,
	Globe,
	ListChecks,
	type LucideIcon,
	Plug,
	Search,
	ShieldCheck,
	SquareTerminal,
	Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { MarkdownDoc } from "../../components/markdown.js";
import { useAgentHue } from "../../hooks/use-agent-hue.js";
import { serverWhere } from "../../lib/format.js";
import type { ProjectAgents, SkillDoc } from "../../lib/types.js";
import type { AgentInfo } from "./AgentDetail.js";
import { harnessOf, writesOf } from "./agent-facts.js";

// What an agent works with: its tools, MCP servers, harness and skills.

/** The agent's tools, in words, and the Claude Code tools each one opens (runner/agent.ts). */
const TOOLS: Record<string, [LucideIcon, string, string]> = {
	read: [Search, "Read the code", "Read · Grep · Glob"],
	edit: [FilePen, "Edit files", "Edit · Write"],
	shell: [SquareTerminal, "Run commands", "Bash"],
	web: [Globe, "Browse the web", "WebFetch · WebSearch"],
	commands: [ListChecks, "Run the project's commands", "run_command"],
};

/** What the agent can run by name, and what judges the code it changes. */
export function Harness({
	data,
	agent,
}: {
	data: ProjectAgents;
	agent: AgentInfo;
}) {
	const commands = data.commands ?? {};
	const { named, checks } = harnessOf(data, agent.tools);
	if (named.length === 0 && checks.length === 0) return null;
	const row = (label: string, names: string[], note?: string) => (
		<div className="py-3 first:pt-0 last:pb-0">
			<p className="text-sm text-fg-2">{label}</p>
			<ul className="mt-2 space-y-1.5">
				{names.map((n) => (
					<li key={n} className="flex items-baseline gap-3 text-sm">
						<span className="w-20 shrink-0 font-medium text-fg">{n}</span>
						<code className="min-w-0 truncate font-mono text-xs text-fg-3">
							{commands[n]}
						</code>
					</li>
				))}
			</ul>
			{note && <p className="mt-2 text-xs text-pretty text-fg-3">{note}</p>}
		</div>
	);
	return (
		<Block icon={ShieldCheck} title="Commands and checks">
			<div className="divide-y divide-line">
				{named.length > 0 && row("It can run, and nothing else by name", named)}
				{checks.length > 0 &&
					row(
						"Before its code leaves this machine, the engine runs",
						checks,
						"A failing check goes back to the agent with its output, twice at most. Code that still fails is not published.",
					)}
			</div>
		</Block>
	);
}

function Block({
	icon: Icon,
	title,
	children,
}: {
	icon: LucideIcon;
	title: string;
	children: ReactNode;
}) {
	return (
		<section className="panel p-5">
			<h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
				<Icon className="size-4 text-fg-2" aria-hidden />
				{title}
			</h3>
			{children}
		</section>
	);
}

/** A skill, as the SKILL.md it is: its name, who reads it, what it is for. */
function Skill({ skill, agent }: { skill: SkillDoc; agent: AgentInfo }) {
	const agentHue = useAgentHue();
	const folder = `openfabriq/${skill.path.slice(0, skill.path.lastIndexOf("/") + 1)}`;
	const badge = {
		shared: {
			label: "Shared",
			title: `In ${folder}: every agent of the factory reads it`,
		},
		area: {
			label: agent.area ?? "",
			title: `In ${folder}: every agent of ${agent.area} reads it`,
		},
		own: { label: "Own", title: `In ${folder}: only ${agent.name} reads it` },
	}[skill.scope];
	return (
		<MarkdownDoc
			title={skill.name}
			badge={
				<span
					className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-2xs font-medium ${skill.scope === "own" ? "bg-hover text-fg-2" : "bg-accent-soft text-accent-text"}`}
					title={badge.title}
				>
					{skill.scope === "shared" ? (
						<Users className="size-3" aria-hidden />
					) : skill.scope === "area" ? (
						<Folder className="size-3" aria-hidden />
					) : (
						<span
							aria-hidden
							className="size-1.5 rounded-[2px]"
							style={{ background: agentHue(agent.name) }}
						/>
					)}
					{badge.label}
				</span>
			}
			{...(skill.description ? { summary: skill.description } : {})}
			path={`openfabriq/${skill.path}`}
			text={skill.content}
			flush
		/>
	);
}

export function Tools({ agent }: { agent: AgentInfo }) {
	return (
		<Block icon={SquareTerminal} title="Tools">
			{agent.tools.length === 0 ? (
				<p className="text-sm text-fg-2">
					No tool: it only reads what it is given.
				</p>
			) : (
				<ul className="space-y-3">
					{agent.tools.map((t) => {
						const [Icon, words, claude] = TOOLS[t] ?? [Bot, t, ""];
						return (
							<li key={t} className="flex gap-3">
								<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sunken ring-1 ring-line">
									<Icon className="size-4 text-fg-2" aria-hidden />
								</span>
								<span className="min-w-0">
									<span className="block text-sm font-medium text-fg">
										{words}
									</span>
									<span className="block font-mono text-xs text-fg-3">
										{claude}
									</span>
								</span>
							</li>
						);
					})}
					{agent.skillDocs.length > 0 && (
						<li className="flex gap-3">
							<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sunken ring-1 ring-line">
								<BookOpen className="size-4 text-fg-2" aria-hidden />
							</span>
							<span className="min-w-0">
								<span className="block text-sm font-medium text-fg">
									Open its skills
								</span>
								<span className="block font-mono text-xs text-fg-3">Skill</span>
							</span>
						</li>
					)}
				</ul>
			)}
		</Block>
	);
}

/** The engine's own server, through which it proposes outputs, then the factory's it lists. */
export function McpServers({
	data,
	agent,
}: {
	data: ProjectAgents;
	agent: AgentInfo;
}) {
	const writes = writesOf(agent.automations);
	return (
		<Block icon={Plug} title="MCP servers">
			<div className="flex gap-3">
				<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
					<Plug className="size-4" aria-hidden />
				</span>
				<div className="min-w-0">
					<p className="flex flex-wrap items-baseline gap-x-2 text-sm">
						<span className="font-mono font-medium text-fg">openfabriq</span>
						<span className="text-xs text-fg-2">built into the engine</span>
					</p>
					<p className="mt-1 text-sm text-fg-2">
						{writes.length
							? "The agent proposes what to write through it; the engine applies only what the automation allows."
							: "No automation lets this agent write, so it has no tool here."}
					</p>
					{writes.length > 0 && (
						<span className="mt-2.5 flex flex-wrap gap-1.5">
							{writes.map((w) => (
								<span key={w} className="chip font-mono">
									{w}
								</span>
							))}
						</span>
					)}
				</div>
			</div>
			{Object.entries(agent.mcp ?? {}).map(([name, tools]) => {
				const server = data.mcp?.[name];
				return (
					<div key={name} className="mt-4 flex gap-3">
						<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sunken ring-1 ring-line">
							<Plug className="size-4 text-fg-2" aria-hidden />
						</span>
						<div className="min-w-0">
							<p className="flex flex-wrap items-baseline gap-x-2 text-sm">
								<span className="font-mono font-medium text-fg">{name}</span>
								<span className="break-all font-mono text-xs text-fg-2">
									{server ? serverWhere(server) : ""}
								</span>
							</p>
							<p className="mt-1 text-sm text-fg-2">
								The agent can call these tools, and no other of this server.
							</p>
							<span className="mt-2.5 flex flex-wrap gap-1.5">
								{tools.map((t) => (
									<span key={t} className="chip font-mono">
										{t}
									</span>
								))}
							</span>
						</div>
					</div>
				);
			})}
			<p className="mt-4 border-t border-line pt-3 text-xs text-pretty text-fg-3">
				{agent.mcp
					? "Only the servers factory.yaml declares and this agent lists"
					: "No other MCP server: factory.yaml declares them, and an agent lists the ones it uses"}
				. Agents get neither your machine's connectors nor the repository's
				servers.
			</p>
		</Block>
	);
}

export function Skills({ agent }: { agent: AgentInfo }) {
	return (
		<Block icon={BookOpen} title="Skills">
			{agent.skillDocs.length === 0 ? (
				<p className="text-sm text-fg-2">
					No skill. Shared ones go in{" "}
					<code className="font-mono text-xs">openfabriq/skills/</code>, this
					agent's own in{" "}
					<code className="font-mono text-xs">
						openfabriq/{resourceFolder("agents", agent.name, agent.area)}
						/skills/
					</code>
					.
				</p>
			) : (
				<div className="-my-3 divide-y divide-line">
					{agent.skillDocs.map((s) => (
						<Skill key={s.path} skill={s} agent={agent} />
					))}
				</div>
			)}
		</Block>
	);
}

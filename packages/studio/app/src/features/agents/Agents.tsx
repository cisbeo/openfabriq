import { Bot, Folder } from "lucide-react";
import { Empty, ErrorNote, PageSkeleton } from "../../components/feedback.js";
import { PageHeader } from "../../components/page-layout.js";
import { useApi } from "../../hooks/use-api.js";
import { query } from "../../lib/api.js";
import { agentHref, pageHref } from "../../lib/route.js";
import type { ProjectAgents, RunRecord } from "../../lib/types.js";
import { AgentCard } from "./AgentCard.js";
import { AgentDetail } from "./AgentDetail.js";
import { agentStats, byArea } from "./agent-facts.js";

export function Agents({
	project,
	name,
	tab,
}: {
	project: string | undefined;
	name: string | undefined;
	tab: string | undefined;
}) {
	const { data, error } = useApi<ProjectAgents>(
		project ? `/api/agents${query({ project })}` : undefined,
	);
	const { data: runs } = useApi<RunRecord[]>(
		project ? `/api/runs${query({ project })}` : undefined,
		5000,
	);

	if (!project)
		return (
			<>
				<PageHeader title="Agents" />
				<Empty icon={<Bot />} title="Choose a project">
					Agents belong to a factory. Pick a project in the menu to see its
					agents, what starts them and what they may write.
				</Empty>
			</>
		);
	if (error && !data)
		return (
			<>
				<PageHeader title="Agents" />
				<ErrorNote>{error}</ErrorNote>
			</>
		);
	if (!data) return <PageSkeleton />;

	const runsOf = (agent: string) =>
		(runs ?? []).filter((r) => r.agent === agent);
	const selected = name ? data.agents.find((a) => a.name === name) : undefined;

	if (name && !selected)
		return (
			<Empty icon={<Bot />} title={`No agent named ${name}`}>
				It may have been renamed or removed from the factory.{" "}
				<a href={pageHref("agents", project)} className="text-accent-text">
					See all agents
				</a>
			</Empty>
		);
	if (selected)
		return (
			<AgentDetail
				data={data}
				agent={selected}
				runs={runsOf(selected.name)}
				project={project}
				tab={tab}
			/>
		);

	return (
		<>
			<PageHeader
				title="Agents"
				description={
					<>
						The agents of {data.name}, from the factory applied to{" "}
						<span className="font-mono text-xs">{data.repository}</span>.
					</>
				}
			/>
			{data.agents.length === 0 ? (
				<Empty icon={<Bot />} title="No agent yet">
					Agents live in{" "}
					<code className="font-mono text-xs">openfabriq/agents/</code>, one
					folder each.
				</Empty>
			) : (
				<div className="space-y-8">
					{byArea(data.agents).map((group) => (
						<section key={group.area ?? ""} aria-label={group.area ?? "Agents"}>
							{group.area && (
								<h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
									<Folder className="size-4 text-fg-3" aria-hidden />
									{group.area}
									<code className="font-mono text-xs font-normal text-fg-3">
										openfabriq/{group.area}/
									</code>
								</h2>
							)}
							<ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
								{group.agents.map((a) => (
									<AgentCard
										key={a.name}
										agent={a}
										stats={agentStats(runsOf(a.name))}
										href={agentHref(a.name, project)}
										defaultModel={data.model}
									/>
								))}
							</ul>
						</section>
					))}
				</div>
			)}
		</>
	);
}

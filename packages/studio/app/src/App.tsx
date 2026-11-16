import { useMemo } from "react";
import { useChatBusy } from "./features/chat/chat-store.js";
import { AgentHueContext } from "./hooks/use-agent-hue.js";
import { useApi } from "./hooks/use-api.js";
import { useHash } from "./hooks/use-hash.js";
import { useProject } from "./hooks/use-project.js";
import { useTheme } from "./hooks/use-theme.js";
import { agentHues } from "./lib/agent-hue.js";
import { query } from "./lib/api.js";
import {
	crumbDetail,
	menuPageOf,
	pageTitle,
	waitsForProjects,
} from "./lib/route.js";
import type { Board } from "./lib/types.js";
import { AppShell, LoadingPage } from "./shell/AppShell.js";
import { PageRouter } from "./shell/PageRouter.js";
import { pageLabel } from "./shell/pages.js";

/** The studio: the frame (menus, breadcrumb, project, theme) around the page the address asks for. */
export function App() {
	const { path, params } = useHash();
	const { projects, project } = useProject(path, params);
	const [theme, nextTheme] = useTheme();
	const page = path[0] ?? "overview";
	const menuPage = menuPageOf(page);
	const label = pageLabel(menuPage);
	const breadcrumbDetail = crumbDetail(path, params);
	const projectBoard = useApi<Board>(
		`/api/board${query({ project })}`,
		5000,
	).data;
	// Every project's agents, so an agent keeps its color whichever project is shown.
	const allProjectsBoard = useApi<Board>(
		project ? "/api/board" : undefined,
		30_000,
	).data;
	const agents = (project ? allProjectsBoard : projectBoard)?.agents;
	const hues = useMemo(
		() => agentHues(agents?.map((a) => a.name) ?? []),
		[agents],
	);
	const chatBusy = useChatBusy();

	return (
		<AgentHueContext value={hues}>
			{/* React puts it first in <head>: index.html's names the tab only until the app starts. */}
			<title>{pageTitle(label, breadcrumbDetail)}</title>
			<AppShell
				frame={{ projects, project, page, menuPage, theme, nextTheme }}
				board={projectBoard}
				chatBusy={chatBusy}
				breadcrumbDetail={breadcrumbDetail}
			>
				{waitsForProjects(page, projects, project) ? (
					<LoadingPage />
				) : (
					<PageRouter
						path={path}
						params={params}
						project={project}
						projects={projects ?? []}
						board={projectBoard}
					/>
				)}
			</AppShell>
		</AgentHueContext>
	);
}

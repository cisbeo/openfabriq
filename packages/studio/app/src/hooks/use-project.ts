import { useEffect } from "react";
import { rememberedProject, rememberProject } from "../lib/project-memory.js";
import { chooseProject, withProject } from "../lib/route.js";
import { useApi } from "./use-api.js";

/**
 * The projects, and the one shown: the address's, else the one chosen last time, else the
 * first. When it is not the address's, the address moves to it, without a new history entry.
 */
export function useProject(path: string[], params: URLSearchParams) {
	const projectInUrl = params.get("project") ?? undefined;
	// Read again like the rest: a project applied while the app is open shows up.
	const projectsAnswer = useApi<string[]>("/api/projects", 5000);
	// Unknown while loading; none when the server fails, whose pages then say why.
	const projects =
		projectsAnswer.data ?? (projectsAnswer.error ? [] : undefined);
	// One project at a time: the studio never mixes them on one page.
	const project = projects
		? chooseProject(projectInUrl, projects, rememberedProject())
		: projectInUrl;
	useEffect(() => {
		if (!projects || !project) return;
		rememberProject(project);
		if (project !== projectInUrl)
			window.location.replace(withProject(path, params, project));
	}, [projects, project, projectInUrl, path, params]);
	return { projects, project };
}

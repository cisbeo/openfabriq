// The project last chosen, for the next visit: a convenience, so a browser without storage still works.
const PROJECT_KEY = "openfabriq.project";

export function rememberedProject(): string | undefined {
	try {
		return localStorage.getItem(PROJECT_KEY) ?? undefined;
	} catch {
		return undefined;
	}
}

export function rememberProject(project: string) {
	try {
		localStorage.setItem(PROJECT_KEY, project);
	} catch {}
}

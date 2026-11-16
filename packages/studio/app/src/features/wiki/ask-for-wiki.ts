import { OFFLINE } from "../../lib/api.js";

/** Asks the engine for a run of the wiki, like `openfabriq run wiki`; undefined when asked. */
export async function askForWiki(project: string): Promise<string | undefined> {
	try {
		const res = await fetch("/api/wiki/refresh", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ project }),
		});
		if (res.ok) return undefined;
		const body = (await res.json()) as { error?: string };
		return body.error ?? `${res.status} ${res.statusText}`;
	} catch {
		return OFFLINE;
	}
}

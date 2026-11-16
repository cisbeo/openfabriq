import { useApi } from "../../hooks/use-api.js";
import { query } from "../../lib/api.js";
import type { RunDetail } from "../../lib/types.js";
import { ACTIVE } from "./what-to-do.js";

/** A run with its log and story, read again every few seconds while it waits or works. */
export function useRun(id: string, project: string | undefined) {
	// While the run works, its log grows: read it again.
	return useApi<RunDetail>(`/api/run${query({ project, id })}`, (data) =>
		data && ACTIVE.has(data.run.status) ? 3000 : undefined,
	);
}

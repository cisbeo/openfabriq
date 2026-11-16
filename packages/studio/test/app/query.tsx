import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createQueryClient } from "../../app/src/lib/query-client.js";

/** The app's reads, as main.tsx sets them up, fresh for each render: `render(ui, { wrapper: WithQueries })`. */
export function WithQueries({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={createQueryClient()}>
			{children}
		</QueryClientProvider>
	);
}

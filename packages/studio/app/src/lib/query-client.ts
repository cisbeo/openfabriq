import { QueryClient } from "@tanstack/react-query";

/**
 * The app's reads: each page says how often it reads (`useApi`), nothing else reads again. No
 * retry (an error shows at once), no read on focus or reconnection (the pace is enough), reads
 * go on in a background tab and without a network, and a page opened again starts from its skeleton.
 */
export function createQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				refetchOnWindowFocus: false,
				refetchOnReconnect: false,
				refetchIntervalInBackground: true,
				// The server is on this machine: a browser that thinks it is offline still reaches it.
				networkMode: "always",
				gcTime: 0,
			},
		},
	});
}

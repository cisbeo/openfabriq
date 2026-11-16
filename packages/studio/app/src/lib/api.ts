export const OFFLINE =
	'The local server does not answer. Is "openfabriq start" running?';

/** `?project=…&status=…`, without the empty ones. */
export function query(params: Record<string, string | undefined>): string {
	const entries = Object.entries(params).filter((e): e is [string, string] =>
		Boolean(e[1]),
	);
	return entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
}

import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { REFRESH_MS } from "./oauth.js";

/**
 * How long a used refresh token still renews: two sessions of a client that share it, such as
 * two Claude Code windows, may both renew it at once. Each then keeps a token of its own.
 */
export const GRACE_MS = 2 * 60_000;
/** Refresh tokens good at once for a grant: one per session that renewed in the same moment. */
const MAX_REFRESH = 5;

/** An access given to a client: kept so that a restart, or a redeploy, does not sign it out. */
interface Grant {
	id: string;
	/** refreshHash of the refresh tokens it accepts. */
	refresh: string[];
	/** Refresh tokens used in the last GRACE_MS, and when. */
	used: { hash: string; at: number }[];
	client: string;
	expiresAt: number;
	/** The GitHub login of who allowed it, with sign-in by GitHub. */
	login?: string;
}

/**
 * The connector's grants, in a file only this user reads. Deleting the file signs every client
 * out: an access token checks that its grant is still there.
 */
export function grantsFile(path: string) {
	const read = (now: number): Grant[] => {
		try {
			const grants: unknown = JSON.parse(readFileSync(path, "utf8"));
			return Array.isArray(grants)
				? (grants as Grant[]).filter((g) => g.expiresAt > now)
				: [];
		} catch {
			return [];
		}
	};
	const write = (grants: Grant[]) => {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(grants), { mode: 0o600 });
		chmodSync(path, 0o600);
	};
	return {
		add(refresh: string, client: string, now: number, login?: string): string {
			const id = randomUUID();
			write([
				...read(now),
				{
					id,
					refresh: [refresh],
					used: [],
					client,
					expiresAt: now + REFRESH_MS,
					...(login ? { login } : {}),
				},
			]);
			return id;
		},
		/**
		 * Swaps a refresh token for the next one: the grant's id, or undefined for an unknown one,
		 * or one used more than GRACE_MS ago. A token used again within the grace adds the next.
		 */
		rotate(refresh: string, next: string, now: number): string | undefined {
			const grants = read(now);
			const grant = grants.find(
				(g) =>
					g.refresh.includes(refresh) ||
					g.used.some((u) => u.hash === refresh && now - u.at < GRACE_MS),
			);
			if (!grant) return undefined;
			const kept = grant.refresh.filter((r) => r !== refresh);
			write(
				grants.map((g) =>
					g === grant
						? {
								...g,
								refresh: [...kept, next].slice(-MAX_REFRESH),
								used: [
									...g.used.filter(
										(u) => u.hash !== refresh && now - u.at < GRACE_MS,
									),
									// The first use starts the grace; a use within it does not extend it.
									g.used.find((u) => u.hash === refresh) ?? {
										hash: refresh,
										at: now,
									},
								],
								expiresAt: now + REFRESH_MS,
							}
						: g,
				),
			);
			return grant.id;
		},
		has: (id: string, now: number) => read(now).some((g) => g.id === id),
		loginOf: (id: string, now: number) =>
			read(now).find((g) => g.id === id)?.login,
	};
}

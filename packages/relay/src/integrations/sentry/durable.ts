// Sentry in the relay's Durable Object: the factories' searches, run every minute by
// the alarm, and their new issues kept for the engine like a webhook.

import type { RelayStore } from "../../shared/store";
import * as sentry from "./api";

/** How often the alarm searches while Sentry is configured and watched. */
export const POLL_EVERY = 60_000;
/** A search starts this long before the last one, so an issue indexed late is not missed. */
const OVERLAP = 2 * POLL_EVERY;

/** A watch and where its search is: `since` in epoch ms, the error last said, if any. */
interface WatchState extends sentry.SentryWatch {
	since: number;
	projectId?: string;
	lastError?: string;
}

const watchKey = (w: sentry.SentryWatch) =>
	`${w.organization}/${w.project}/${w.query ?? ""}`;

export class SentryHandler {
	constructor(private readonly store: RelayStore) {}

	async configure(config: sentry.SentryConfig): Promise<void> {
		this.store.kv.put("sentry:config", config);
		await this.armPolling();
	}

	/** A watch kept from the last list keeps its point; a new one starts now. */
	async watch(watches: sentry.SentryWatch[]): Promise<void> {
		const before = new Map(this.watches().map((w) => [watchKey(w), w]));
		const now = Date.now();
		this.store.kv.put(
			"sentry:watches",
			watches.map(
				(w): WatchState =>
					before.get(watchKey(w)) ?? { ...sentry.watchFields(w), since: now },
			),
		);
		await this.armPolling();
	}

	polling(): boolean {
		return !!this.config() && this.watches().length > 0;
	}

	/** One watch failing never holds the others back; an error is said once, not every minute. */
	async poll(): Promise<void> {
		const config = this.config();
		if (!config) return;
		const started = Date.now();
		for (const watch of this.watches()) {
			const watchFields = sentry.watchFields(watch);
			try {
				const id = watch.projectId ?? (await sentry.projectId(config, watch));
				const issues = await sentry.issuesSince(config, watch, id, watch.since);
				for (const issue of issues)
					await this.store.enqueue(
						{
							service: "sentry",
							kind: "issue",
							...watchFields,
							issue: {
								id: issue.id,
								shortId: issue.shortId,
								permalink: issue.permalink,
								firstSeen: issue.firstSeen,
							},
						},
						`sentry:${watchKey(watch)}:${issue.id}`,
					);
				this.updateWatch(watch, {
					projectId: id,
					// Never before the point it had: a new watch would find issues older than itself.
					since: Math.max(watch.since, started - OVERLAP),
					lastError: undefined,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (message === watch.lastError) continue;
				await this.store.enqueue({
					service: "sentry",
					kind: "error",
					...watchFields,
					message,
				});
				this.updateWatch(watch, { lastError: message });
			}
		}
	}

	private watches(): WatchState[] {
		return this.store.kv.get<WatchState[]>("sentry:watches") ?? [];
	}

	private config(): sentry.SentryConfig | undefined {
		return this.store.kv.get<sentry.SentryConfig>("sentry:config");
	}

	/** Polling starts within a minute, not at the next daily cleanup. */
	private async armPolling(): Promise<void> {
		if (this.polling()) await this.store.wakeWithin(POLL_EVERY);
	}

	/** Written to the list as it is now: the engine may have replaced it during a search. */
	private updateWatch(watch: WatchState, change: Partial<WatchState>): void {
		const key = watchKey(watch);
		this.store.kv.put(
			"sentry:watches",
			this.watches().map((w) => {
				if (watchKey(w) !== key) return w;
				const updated: WatchState = { ...w, ...change };
				if (updated.lastError === undefined) delete updated.lastError;
				return updated;
			}),
		);
	}
}

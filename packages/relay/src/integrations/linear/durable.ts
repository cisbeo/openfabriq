// Linear in the relay's Durable Object: the openfabriq app's install, its tokens,
// and the webhooks Linear sends it.

import { sameSecret } from "../../shared/crypto";
import { parseJsonBody } from "../../shared/http";
import type { RelayStore } from "../../shared/store";
import * as linear from "./api";
import { verifySignature } from "./signature";

const REFRESH_MARGIN = 5 * 60_000;
const FRESHNESS_MS = 60_000;
const NOT_POSTED = "Could not post the received thought:";

export interface LinearConfig extends linear.LinearApp {
	webhookSecret: string;
}

interface StoredLinearConfig extends LinearConfig {
	state: string | null;
}

interface LinearOrg extends linear.LinearTokens {
	organizationId: string;
	organizationName: string;
	appUserId: string;
}

/** How an install ended: the organization's name, or why there is none. */
export type LinearInstall =
	| { kind: "installed"; organizationName: string }
	| { kind: "unknown-state" }
	| { kind: "code-refused" };

interface LinearWebhook {
	webhookTimestamp?: unknown;
	type?: unknown;
	action?: unknown;
	organizationId?: unknown;
	agentSession?: { id?: unknown };
}

/**
 * A signed webhook's body and Linear-Delivery header, or null when it is not a fresh Linear
 * delivery: not JSON, no delivery id, or a webhookTimestamp more than a minute from `now`.
 */
export function parseLinearHook(
	body: ArrayBuffer,
	delivery: string | null,
	now: number,
): { delivery: string; payload: LinearWebhook } | null {
	const payload = parseJsonBody(body) as LinearWebhook | null | undefined;
	const timestamp = payload?.webhookTimestamp;
	if (
		!payload ||
		!delivery ||
		typeof timestamp !== "number" ||
		Math.abs(now - timestamp) > FRESHNESS_MS
	)
		return null;
	return { delivery, payload };
}

export class LinearHandler {
	private readonly refreshing = new Map<string, Promise<LinearOrg>>();

	constructor(private readonly store: RelayStore) {}

	configure(config: LinearConfig, origin: string): string {
		const state = crypto.randomUUID();
		this.store.kv.put("linear:config", { ...config, state });
		return linear.authorizeUrl(config.clientId, origin, state);
	}

	/** The state is used once, even when Linear then refuses the code. */
	async install(
		code: string,
		state: string,
		origin: string,
	): Promise<LinearInstall> {
		const config = this.config();
		if (!config?.state || !sameSecret(state, config.state))
			return { kind: "unknown-state" };
		this.store.kv.put("linear:config", { ...config, state: null });

		let tokens: linear.LinearTokens;
		try {
			tokens = await linear.exchangeCode(config, code, origin);
		} catch (error) {
			console.error(
				"Could not install Linear:",
				error instanceof Error ? error.message : error,
			);
			return { kind: "code-refused" };
		}
		const { viewer } = await linear.viewer(tokens.accessToken);
		const org: LinearOrg = {
			organizationId: viewer.organization.id,
			organizationName: viewer.organization.name,
			appUserId: viewer.id,
			...tokens,
		};
		this.store.kv.put(`linear:org:${org.organizationId}`, org);
		await this.store.enqueue({
			service: "linear",
			kind: "installed",
			organizationId: org.organizationId,
			organizationName: org.organizationName,
			appUserId: org.appUserId,
		});
		return { kind: "installed", organizationName: org.organizationName };
	}

	async tokens() {
		const orgs = [
			...this.store.kv.list<LinearOrg>({ prefix: "linear:org:" }),
		].map(([, org]) => org);
		// One organization's refused refresh (a revoked install) leaves it out, not the others:
		// the engine then says to run "openfabriq connect linear" for that one alone.
		const current = await Promise.all(
			orgs.map((stored) =>
				this.withFreshToken(stored).catch((error) => {
					console.error(
						`Could not refresh the Linear token of ${stored.organizationId}:`,
						error instanceof Error ? error.message : error,
					);
					return null;
				}),
			),
		);
		return current
			.filter((org) => org !== null)
			.map((org) => ({
				organizationId: org.organizationId,
				organizationName: org.organizationName,
				appUserId: org.appUserId,
				accessToken: org.accessToken,
				expiresAt: org.expiresAt,
			}));
	}

	async receiveHook(
		body: ArrayBuffer,
		signature: string | null,
		delivery: string | null,
	): Promise<200 | 400 | 401> {
		const secret = this.config()?.webhookSecret;
		if (!secret || !(await verifySignature(body, signature, secret)))
			return 401;
		const hook = parseLinearHook(body, delivery, Date.now());
		if (!hook) return 400;
		const kept = await this.store.enqueue(
			{ service: "linear", kind: "webhook", ...hook },
			`linear:${hook.delivery}`,
		);
		if (kept !== "queued") return 200;
		const { payload } = hook;
		if (payload.type === "AgentSessionEvent" && payload.action === "created")
			this.store.waitUntil(
				this.acknowledgeSession(
					payload.organizationId,
					payload.agentSession?.id,
				),
			);
		return 200;
	}

	private config(): StoredLinearConfig | undefined {
		return this.store.kv.get<StoredLinearConfig>("linear:config");
	}

	// Linear access tokens last 24 h and each refresh rotates the refresh token: a second refresh
	// with the same refresh token could be refused, so callers share the one in flight.
	private async withFreshToken(org: LinearOrg): Promise<LinearOrg> {
		if (org.expiresAt - Date.now() > REFRESH_MARGIN) return org;
		const id = org.organizationId;
		let refresh = this.refreshing.get(id);
		if (!refresh) {
			refresh = this.refresh(org).finally(() => this.refreshing.delete(id));
			this.refreshing.set(id, refresh);
		}
		return refresh;
	}

	private async refresh(org: LinearOrg): Promise<LinearOrg> {
		const config = this.config();
		if (!config) throw new Error("Linear is not configured");
		const refreshed = {
			...org,
			...(await linear
				.refreshTokens(config, org.refreshToken)
				.catch((error: unknown) => {
					// Uninstalled: its tokens will never work again, so they are not kept nor refreshed again.
					if (error instanceof linear.LinearTokenRefused && error.revoked) {
						this.store.kv.delete(`linear:org:${org.organizationId}`);
						console.error(
							`Forgot the Linear install of ${org.organizationId}: Linear says its grant is gone.`,
						);
					}
					throw error;
				})),
		};
		this.store.kv.put(`linear:org:${org.organizationId}`, refreshed);
		return refreshed;
	}

	private async acknowledgeSession(
		organizationId: unknown,
		agentSessionId: unknown,
	): Promise<void> {
		try {
			const org = this.store.kv.get<LinearOrg>(`linear:org:${organizationId}`);
			if (!org || typeof agentSessionId !== "string") {
				console.error(NOT_POSTED, "no Linear installation for this session");
				return;
			}
			const { accessToken } = await this.withFreshToken(org);
			await linear.postReceivedThought(accessToken, agentSessionId);
		} catch (error) {
			console.error(NOT_POSTED, error instanceof Error ? error.message : error);
		}
	}
}

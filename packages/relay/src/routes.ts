import type { Relay } from "./relay";

export type RelayStub = DurableObjectStub<Relay>;

/**
 * Routes open to the Internet: each request proves itself (its sender's signature, an OAuth
 * state), checked in the Durable Object. Their answer, or undefined when the request is not for them.
 */
export type HookRoutes = (
	request: Request,
	url: URL,
	relay: RelayStub,
) => Promise<Response | undefined>;

/** A route only the engine may call. */
export type EngineRoute = (
	request: Request,
	url: URL,
	relay: RelayStub,
) => Promise<Response>;

/**
 * The engine route a request is for, found from its method and path alone: index.ts answers 401
 * without the engine's token, before calling it.
 */
export type EngineRoutes = (
	request: Request,
	url: URL,
) => EngineRoute | undefined;

/** An integration's routes in the Worker; no two integrations share a path. */
export interface IntegrationRoutes {
	hookRoutes?: HookRoutes;
	engineRoutes: EngineRoutes;
}

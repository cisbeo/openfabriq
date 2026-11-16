const API = "https://api.linear.app";

export const RECEIVED_THOUGHT =
	"Received: openfabriq takes it as soon as a run is free.";

export interface LinearApp {
	clientId: string;
	clientSecret: string;
}

export interface LinearTokens {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
}

function callbackUrl(origin: string): string {
	return `${origin}/oauth/linear/callback`;
}

export function authorizeUrl(
	clientId: string,
	origin: string,
	state: string,
): string {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: callbackUrl(origin),
		response_type: "code",
		scope: "read,write,app:assignable,app:mentionable",
		state,
		actor: "app",
	});
	return `https://linear.app/oauth/authorize?${params}`;
}

export function exchangeCode(
	app: LinearApp,
	code: string,
	origin: string,
): Promise<LinearTokens> {
	return requestTokens(app, {
		grant_type: "authorization_code",
		code,
		redirect_uri: callbackUrl(origin),
	});
}

/** Linear refused a token request; `revoked` when the grant itself is gone: the organization uninstalled the app. */
export class LinearTokenRefused extends Error {
	constructor(
		readonly status: number,
		readonly revoked: boolean,
	) {
		super(`Linear refused the token request (${status})`);
	}
}

export function refreshTokens(
	app: LinearApp,
	refreshToken: string,
): Promise<LinearTokens> {
	return requestTokens(app, {
		grant_type: "refresh_token",
		refresh_token: refreshToken,
	});
}

async function requestTokens(
	app: LinearApp,
	params: Record<string, string>,
): Promise<LinearTokens> {
	const response = await fetch(`${API}/oauth/token`, {
		method: "POST",
		body: new URLSearchParams({
			...params,
			client_id: app.clientId,
			client_secret: app.clientSecret,
		}),
	});
	if (!response.ok)
		throw new LinearTokenRefused(
			response.status,
			// OAuth's invalid_grant (RFC 6749) on a refresh: this grant is gone for good, the install was removed.
			params.grant_type === "refresh_token" &&
				response.status === 400 &&
				(await response.text()).includes("invalid_grant"),
		);
	const tokens = await response.json<{
		access_token: string;
		expires_in: number;
		refresh_token: string;
	}>();
	return {
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		expiresAt: Date.now() + tokens.expires_in * 1000,
	};
}

async function graphql<T>(
	accessToken: string,
	query: string,
	variables: Record<string, unknown> = {},
): Promise<T> {
	const response = await fetch(`${API}/graphql`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ query, variables }),
	});
	const result = await response.json<{ data?: T; errors?: unknown[] }>();
	if (!response.ok || result.errors || !result.data)
		throw new Error(`Linear GraphQL call failed (${response.status})`);
	return result.data;
}

export function viewer(accessToken: string) {
	return graphql<{
		viewer: { id: string; organization: { id: string; name: string } };
	}>(accessToken, "query { viewer { id organization { id name } } }");
}

export function postReceivedThought(
	accessToken: string,
	agentSessionId: string,
) {
	return graphql(
		accessToken,
		"mutation($input: AgentActivityCreateInput!){ agentActivityCreate(input:$input){ success } }",
		{
			input: {
				agentSessionId,
				content: { type: "thought", body: RECEIVED_THOUGHT },
			},
		},
	);
}

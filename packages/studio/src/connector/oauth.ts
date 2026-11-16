import {
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

// The connector's OAuth, as Claude asks for it: the studio is both the MCP server (the resource)
// and the authorization server, and its password is the only key.

/** Where Claude (claude.ai, Claude Desktop, the mobile apps) brings the code back. */
export const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
export const ACCESS_SECONDS = 3600;
/** How long a refresh token stays good after its last use. */
export const REFRESH_MS = 30 * 24 * 3600_000;
export const CODE_MS = 60_000;

/** The connector's addresses on the studio's domain. */
export function connectorUrls(studio: URL) {
	const issuer = studio.origin;
	return {
		issuer,
		/** The URL to give Claude. */
		resource: `${issuer}/mcp`,
		resourceMetadata: `${issuer}/.well-known/oauth-protected-resource/mcp`,
		authorize: `${issuer}/oauth/authorize`,
		token: `${issuer}/oauth/token`,
		register: `${issuer}/oauth/register`,
	};
}

/** RFC 9728: what the connector is, and who gives its tokens. */
export const protectedResource = (studio: URL) => ({
	resource: connectorUrls(studio).resource,
	authorization_servers: [connectorUrls(studio).issuer],
	bearer_methods_supported: ["header"],
	resource_name: "openfabriq",
});

/** RFC 8414: how to get a token. */
export function authorizationServer(studio: URL) {
	const urls = connectorUrls(studio);
	return {
		issuer: urls.issuer,
		authorization_endpoint: urls.authorize,
		token_endpoint: urls.token,
		registration_endpoint: urls.register,
		response_types_supported: ["code"],
		grant_types_supported: ["authorization_code", "refresh_token"],
		code_challenge_methods_supported: ["S256"],
		token_endpoint_auth_methods_supported: ["none"],
	};
}

/**
 * Who a redirect address gives the access to: Claude's callback, or Claude Code's loopback on
 * any port. Undefined for any other address, so a crafted link cannot send the code elsewhere.
 */
export function redirectTarget(uri: string): string | undefined {
	if (uri === CLAUDE_CALLBACK) return "Claude";
	const url = URL.canParse(uri) ? new URL(uri) : undefined;
	const loopback =
		url?.protocol === "http:" &&
		(url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
		!url.username &&
		!url.password &&
		!url.hash;
	return loopback ? "Claude Code on this computer" : undefined;
}

const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

/** PKCE with S256: the verifier hashes to the challenge sent with the authorization. */
export const pkceMatches = (verifier: string, challenge: string): boolean =>
	VERIFIER.test(verifier) &&
	sameText(
		createHash("sha256").update(verifier).digest("base64url"),
		challenge,
	);

const sameText = (a: string, b: string) =>
	a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** A random code or token. */
export const newSecret = () => randomBytes(32).toString("base64url");

/**
 * The key that signs the tokens, from the password, or from the GitHub App's client secret with
 * sign-in by GitHub: a new secret voids every token.
 */
export const tokenKey = (
	secret: string,
	use = "openfabriq connector",
): Buffer => createHmac("sha256", secret).update(use).digest();

const mac = (key: Buffer, text: string) =>
	createHmac("sha256", key).update(text).digest("base64url");

/** Data signed by this key for one use (`kind`): `<payload>.<signature>`, so nothing is kept for it. */
export function seal(key: Buffer, kind: string, data: object): string {
	const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
	return `${payload}.${mac(key, `${kind}.${payload}`)}`;
}

/** The data of a `seal` of this key and kind, or undefined for anything else. */
export function unseal(
	key: Buffer,
	kind: string,
	token: string,
): Record<string, unknown> | undefined {
	const [payload = "", signature = "", ...rest] = token.split(".");
	if (rest.length || !sameText(signature, mac(key, `${kind}.${payload}`)))
		return undefined;
	try {
		const data: unknown = JSON.parse(
			Buffer.from(payload, "base64url").toString("utf8"),
		);
		return typeof data === "object" && data !== null
			? (data as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

/** An access token for a grant, good for an hour: signed, so nothing is kept for it. */
export const signAccess = (key: Buffer, grant: string, now: number): string =>
	seal(key, "access", { grant, exp: Math.floor(now / 1000) + ACCESS_SECONDS });

/** The grant of an access token this key signed and that has not expired, or undefined. */
export function readAccess(
	key: Buffer,
	token: string,
	now: number,
): string | undefined {
	const data = unseal(key, "access", token);
	return typeof data?.grant === "string" &&
		typeof data.exp === "number" &&
		now < data.exp * 1000
		? data.grant
		: undefined;
}

/** What the grants file keeps of a refresh token: never the token itself. */
export const refreshHash = (key: Buffer, token: string) =>
	mac(key, `refresh.${token}`);

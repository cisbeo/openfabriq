/** How the studio opens besides the address printed by `start`. */
export interface StudioAccess {
	/** OPENFABRIQ_STUDIO_PASSWORD: a sign-in form sets the same cookie as `?token=`. */
	password?: string;
	/** OPENFABRIQ_STUDIO_URL: a public https address the studio also answers on. */
	url?: URL;
	/** GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET: sign-in with GitHub, through the team's GitHub App. */
	github?: { clientId: string; clientSecret: string };
}

const MIN_PASSWORD = 16;

/** The studio's access from the engine's environment; throws on a value that would open it badly. */
export function studioAccess(env: NodeJS.ProcessEnv): StudioAccess {
	// docker compose passes `${X:-}`: empty is absent.
	const password = env.OPENFABRIQ_STUDIO_PASSWORD || undefined;
	const address = env.OPENFABRIQ_STUDIO_URL || undefined;
	const clientId = env.GITHUB_APP_CLIENT_ID || undefined;
	const clientSecret = env.GITHUB_APP_CLIENT_SECRET || undefined;
	if (password !== undefined && password.length < MIN_PASSWORD)
		throw new Error(
			`OPENFABRIQ_STUDIO_PASSWORD must be ${MIN_PASSWORD} characters or more; for example: openssl rand -base64 24`,
		);
	if (!clientId !== !clientSecret)
		throw new Error(
			"Sign-in with GitHub takes both GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET",
		);
	const github =
		clientId && clientSecret ? { clientId, clientSecret } : undefined;
	if (address === undefined) {
		if (github)
			throw new Error(
				"Sign-in with GitHub comes back to the studio's https address: set OPENFABRIQ_STUDIO_URL too",
			);
		return password ? { password } : {};
	}
	if (!password && !github)
		throw new Error(
			"OPENFABRIQ_STUDIO_URL opens the studio to a domain: set OPENFABRIQ_STUDIO_PASSWORD, or GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET",
		);
	const url = URL.canParse(address) ? new URL(address) : undefined;
	if (
		url?.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	)
		throw new Error(
			`OPENFABRIQ_STUDIO_URL is an https address with no path, like https://factory.example.com, not ${address}`,
		);
	return {
		...(password ? { password } : {}),
		url,
		...(github ? { github } : {}),
	};
}

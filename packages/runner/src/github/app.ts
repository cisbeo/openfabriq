import { createSign } from "node:crypto";
import { readSecrets } from "../state/secrets.js";

// The engine as a GitHub App its team owns, instead of a person's or a bot account's token: from
// GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (they win), or what "openfabriq connect github" saved.
// Each repository gets its own installation token, scoped to it and renewed before it expires;
// gh and git receive it in their environment only, never an agent.

export interface AppCredentials {
	id: string;
	privateKey: string;
	/** Saved by connect github; asked of GitHub otherwise. */
	slug?: string;
}

/** A private key in one line, as a server's variable holds it: the PEM with \n escapes, or its base64. */
export function readPrivateKey(value: string): string {
	const text = value.includes("-----BEGIN")
		? value
		: Buffer.from(value, "base64").toString("utf8");
	return text.replaceAll("\\n", "\n").trim();
}

/** The app's credentials: the environment wins over what connect github saved. */
export function appCredentials(
	env: NodeJS.ProcessEnv = process.env,
	saved:
		| { app_id?: string; slug?: string; private_key?: string }
		| undefined = readSecrets(env).github,
): AppCredentials | undefined {
	if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY)
		return {
			id: env.GITHUB_APP_ID,
			privateKey: readPrivateKey(env.GITHUB_APP_PRIVATE_KEY),
		};
	if (saved?.app_id && saved.private_key)
		return {
			id: saved.app_id,
			privateKey: saved.private_key,
			...(saved.slug ? { slug: saved.slug } : {}),
		};
	return undefined;
}

const base64url = (data: string | Buffer) =>
	Buffer.from(data).toString("base64url");

/** The app's JWT (RS256): issued a minute ago against clock drift, valid 9 minutes (GitHub allows 10). */
export function appJwt(
	appId: string,
	privateKey: string,
	nowSeconds: number,
): string {
	const head = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const claims = base64url(
		JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId }),
	);
	const signature = createSign("RSA-SHA256")
		.update(`${head}.${claims}`)
		.sign(privateKey);
	return `${head}.${claims}.${base64url(signature)}`;
}

/** Renewed when it has less than this left: a long git push never starts with a token about to expire. */
const RENEW_BEFORE_MS = 5 * 60_000;

export interface GitHubApp {
	/** An installation token for this repository alone. Rejects when the app is not installed on it. */
	token(repository: string): Promise<string>;
	/** Whether the app is installed on this repository. */
	installed(repository: string): Promise<boolean>;
	/** The app's login on GitHub: <slug>[bot]. */
	login(): Promise<string>;
	/** The identity GitHub links to the app in a commit. */
	identity(): Promise<{ name: string; email: string }>;
	/** Where a person installs the app on more repositories. */
	installUrl(): Promise<string>;
	/** Drops this repository's token and installation: GitHub revoked them (the app was installed again). */
	forget(repository: string): void;
}

/** Remembers a promise; a failure is asked again next time. */
function once<T>(
	cache: Map<string, Promise<T>>,
	key: string,
	make: () => Promise<T>,
): Promise<T> {
	let value = cache.get(key);
	if (!value) {
		value = make();
		cache.set(key, value);
		value.catch(() => cache.delete(key));
	}
	return value;
}

export function createGitHubApp(
	credentials: AppCredentials,
	deps: { fetch?: typeof fetch; now?: () => number } = {},
): GitHubApp {
	const now = deps.now ?? Date.now;
	const call = async <T>(
		path: string,
		auth: "app" | "none",
		method = "GET",
		body?: unknown,
	): Promise<T> => {
		const response = await (deps.fetch ?? fetch)(
			`https://api.github.com${path}`,
			{
				method,
				headers: {
					Accept: "application/vnd.github+json",
					...(auth === "app"
						? {
								Authorization: `Bearer ${appJwt(credentials.id, credentials.privateKey, Math.floor(now() / 1000))}`,
							}
						: {}),
					...(body ? { "Content-Type": "application/json" } : {}),
				},
				...(body ? { body: JSON.stringify(body) } : {}),
			},
		);
		const data = (await response.json().catch(() => ({}))) as T & {
			message?: string;
		};
		if (!response.ok)
			throw Object.assign(
				new Error(
					`GitHub answered ${response.status} to ${method} ${path}${data.message ? `: ${data.message}` : ""}`,
				),
				{ status: response.status },
			);
		return data;
	};

	const memo = new Map<string, Promise<unknown>>();
	const slug = () =>
		credentials.slug
			? Promise.resolve(credentials.slug)
			: (once(memo, "slug", () =>
					call<{ slug: string }>("/app", "app").then((app) => app.slug),
				) as Promise<string>);
	const installations = new Map<string, Promise<number>>();
	const installation = (repository: string) =>
		once(installations, repository.toLowerCase(), async () => {
			try {
				return (
					await call<{ id: number }>(`/repos/${repository}/installation`, "app")
				).id;
			} catch (error) {
				if ((error as { status?: number }).status !== 404) throw error;
				throw new Error(
					`the GitHub App ${await slug()} is not installed on ${repository}: install it at ${await self.installUrl()}`,
				);
			}
		});
	const tokens = new Map<string, Promise<{ token: string; expires: number }>>();

	const self: GitHubApp = {
		async token(repository) {
			const key = repository.toLowerCase();
			const entry = tokens.get(key);
			const cached = await entry?.catch(() => undefined);
			if (cached && cached.expires - now() > RENEW_BEFORE_MS)
				return cached.token;
			// Unless a call meanwhile started the next one.
			if (tokens.get(key) === entry) tokens.delete(key);
			return (
				await once(tokens, key, async () => {
					const id = await installation(repository);
					const { token, expires_at } = await call<{
						token: string;
						expires_at: string;
					}>(`/app/installations/${id}/access_tokens`, "app", "POST", {
						// Scoped to the one repository the call is for.
						repositories: [repository.split("/")[1]],
					}).catch((error: unknown) => {
						// Uninstalled, or installed again under a new id: asked again next time.
						installations.delete(key);
						throw error;
					});
					return { token, expires: Date.parse(expires_at) };
				})
			).token;
		},
		async installed(repository) {
			return installation(repository).then(
				() => true,
				(error: unknown) => {
					if (/is not installed/.test(String(error))) return false;
					throw error;
				},
			);
		},
		async login() {
			return `${await slug()}[bot]`;
		},
		async identity() {
			const login = await self.login();
			// Public: no token needed.
			const user = (await once(memo, "user", () =>
				call<{ id: number }>(`/users/${encodeURIComponent(login)}`, "none"),
			)) as { id: number };
			return {
				name: login,
				email: `${user.id}+${login}@users.noreply.github.com`,
			};
		},
		async installUrl() {
			return `https://github.com/apps/${await slug()}/installations/new`;
		},
		forget(repository) {
			tokens.delete(repository.toLowerCase());
			installations.delete(repository.toLowerCase());
		},
	};
	return self;
}

// Read once per process: a running engine reads its connections when it starts.
let current: GitHubApp | null | undefined;

/** The engine's GitHub App, or undefined in local mode (gh's own login). */
export function githubApp(): GitHubApp | undefined {
	if (current === undefined) {
		const credentials = appCredentials();
		current = credentials ? createGitHubApp(credentials) : null;
	}
	return current ?? undefined;
}

/** The environment of a gh or git call for this repository: its token in app mode, otherwise the process's own. */
export async function githubEnv(
	repository: string,
): Promise<NodeJS.ProcessEnv | undefined> {
	const app = githubApp();
	if (!app) return undefined;
	return { ...process.env, GH_TOKEN: await app.token(repository) };
}

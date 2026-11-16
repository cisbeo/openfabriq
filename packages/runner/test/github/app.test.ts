import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	appCredentials,
	appJwt,
	createGitHubApp,
	readPrivateKey,
} from "../../src/github/app.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});

const decode = (part: string) =>
	JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<
		string,
		unknown
	>;

describe("appJwt", () => {
	it("signs RS256 claims GitHub accepts: issued a minute ago, under 10 minutes, by the app", () => {
		const jwt = appJwt("12345", privateKey, 1_000_000);
		const [head, claims, signature] = jwt.split(".") as [
			string,
			string,
			string,
		];
		expect(decode(head)).toEqual({ alg: "RS256", typ: "JWT" });
		const { iat, exp, iss } = decode(claims) as {
			iat: number;
			exp: number;
			iss: string;
		};
		expect(iss).toBe("12345");
		expect(iat).toBe(1_000_000 - 60);
		expect(exp - 1_000_000).toBeLessThan(600);
		expect(exp).toBeGreaterThan(1_000_000);
		const valid = createVerify("RSA-SHA256")
			.update(`${head}.${claims}`)
			.verify(publicKey, Buffer.from(signature, "base64url"));
		expect(valid).toBe(true);
	});
});

describe("readPrivateKey", () => {
	it("reads the PEM with escaped newlines, or its base64, as a server's variable holds it", () => {
		const escaped = privateKey.replaceAll("\n", "\\n");
		expect(readPrivateKey(escaped)).toBe(privateKey.trim());
		expect(readPrivateKey(Buffer.from(privateKey).toString("base64"))).toBe(
			privateKey.trim(),
		);
		expect(readPrivateKey(privateKey)).toBe(privateKey.trim());
	});
});

describe("appCredentials", () => {
	const saved = { app_id: "1", slug: "acme-factory", private_key: "saved" };
	it("takes the environment over what connect github saved", () => {
		expect(
			appCredentials(
				{ GITHUB_APP_ID: "2", GITHUB_APP_PRIVATE_KEY: privateKey },
				saved,
			),
		).toEqual({ id: "2", privateKey: privateKey.trim() });
		expect(appCredentials({}, saved)).toEqual({
			id: "1",
			privateKey: "saved",
			slug: "acme-factory",
		});
	});
	it("is undefined without both: local mode, gh's own login", () => {
		expect(appCredentials({ GITHUB_APP_ID: "2" }, undefined)).toBeUndefined();
		expect(appCredentials({}, { app_id: "1" })).toBeUndefined();
	});
});

/** A fake GitHub API: answers by "METHOD path", records each call. */
function fakeGitHub(
	answers: Record<string, (body: unknown) => [number, unknown]>,
) {
	const calls: { route: string; auth?: string; body?: unknown }[] = [];
	const fetch = (async (url: string, init: RequestInit = {}) => {
		const route = `${init.method ?? "GET"} ${new URL(url).pathname}`;
		const body = init.body ? JSON.parse(String(init.body)) : undefined;
		const auth = (init.headers as Record<string, string>).Authorization;
		calls.push({ route, ...(auth ? { auth } : {}), ...(body ? { body } : {}) });
		const answer = answers[route];
		const [status, data] = answer
			? answer(body)
			: [404, { message: "Not Found" }];
		return new Response(JSON.stringify(data), { status });
	}) as typeof globalThis.fetch;
	return { calls, fetch };
}

describe("createGitHubApp", () => {
	let issued = 0;
	const github = () =>
		fakeGitHub({
			"GET /repos/acme/web/installation": () => [200, { id: 7 }],
			"POST /app/installations/7/access_tokens": () => [
				201,
				{
					token: `ghs_${++issued}`,
					expires_at: new Date(clock.now + 3_600_000).toISOString(),
				},
			],
			"GET /app": () => [200, { slug: "acme-factory" }],
			"GET /users/acme-factory%5Bbot%5D": () => [200, { id: 99 }],
		});
	const clock = { now: Date.parse("2026-11-10T00:00:00Z") };

	it("mints a token scoped to the repository with the app's JWT, and keeps it until 5 minutes before it expires", async () => {
		issued = 0;
		const { calls, fetch } = github();
		const app = createGitHubApp(
			{ id: "12", privateKey },
			{ fetch, now: () => clock.now },
		);
		const start = clock.now;
		expect(await app.token("acme/web")).toBe("ghs_1");
		expect(calls[1]).toMatchObject({
			route: "POST /app/installations/7/access_tokens",
			body: { repositories: ["web"] },
		});
		expect(calls[0]?.auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
		clock.now = start + 54 * 60_000;
		expect(await app.token("ACME/web")).toBe("ghs_1");
		clock.now = start + 56 * 60_000;
		expect(await app.token("acme/web")).toBe("ghs_2");
		// The installation is asked once.
		expect(calls.filter((c) => c.route.endsWith("/installation"))).toHaveLength(
			1,
		);
	});

	it("mints one token for calls that come together", async () => {
		const { calls, fetch } = github();
		const app = createGitHubApp(
			{ id: "12", privateKey },
			{ fetch, now: () => clock.now },
		);
		const [a, b] = await Promise.all([
			app.token("acme/web"),
			app.token("acme/web"),
		]);
		expect(a).toBe(b);
		expect(calls.filter((c) => c.route.startsWith("POST"))).toHaveLength(1);
	});

	it("says where to install the app on a repository it is not on", async () => {
		const { fetch } = github();
		const app = createGitHubApp(
			{ id: "12", privateKey, slug: "acme-factory" },
			{ fetch, now: () => clock.now },
		);
		await expect(app.token("acme/other")).rejects.toThrow(
			"the GitHub App acme-factory is not installed on acme/other: install it at https://github.com/apps/acme-factory/installations/new",
		);
		expect(await app.installed("acme/other")).toBe(false);
		expect(await app.installed("acme/web")).toBe(true);
	});

	it("is <slug>[bot] on GitHub, and commits as the bot's noreply address", async () => {
		const { fetch } = github();
		const app = createGitHubApp(
			{ id: "12", privateKey },
			{ fetch, now: () => clock.now },
		);
		expect(await app.login()).toBe("acme-factory[bot]");
		expect(await app.identity()).toEqual({
			name: "acme-factory[bot]",
			email: "99+acme-factory[bot]@users.noreply.github.com",
		});
	});

	it("finds the installation again when the app was installed again under a new id", async () => {
		let id = 7;
		const { fetch } = fakeGitHub({
			"GET /repos/acme/web/installation": () => [200, { id }],
			"POST /app/installations/8/access_tokens": () => [
				201,
				{ token: "ghs_new", expires_at: "2099-01-01T00:00:00Z" },
			],
		});
		const app = createGitHubApp({ id: "12", privateKey }, { fetch });
		await expect(app.token("acme/web")).rejects.toThrow("404");
		id = 8;
		expect(await app.token("acme/web")).toBe("ghs_new");
	});

	it("forgets a repository's token and installation, so the next call mints a new one", async () => {
		issued = 0;
		const { calls, fetch } = github();
		const app = createGitHubApp(
			{ id: "12", privateKey },
			{ fetch, now: () => clock.now },
		);
		expect(await app.token("acme/web")).toBe("ghs_1");
		app.forget("ACME/web");
		expect(await app.token("acme/web")).toBe("ghs_2");
		expect(calls.filter((c) => c.route.endsWith("/installation"))).toHaveLength(
			2,
		);
	});

	it("asks again after a failure", async () => {
		let down = true;
		const { fetch } = fakeGitHub({
			"GET /repos/acme/web/installation": () =>
				down ? [502, { message: "Bad gateway" }] : [200, { id: 7 }],
			"POST /app/installations/7/access_tokens": () => [
				201,
				{ token: "ghs_x", expires_at: "2099-01-01T00:00:00Z" },
			],
		});
		const app = createGitHubApp({ id: "12", privateKey }, { fetch });
		await expect(app.token("acme/web")).rejects.toThrow(
			"GitHub answered 502 to GET /repos/acme/web/installation: Bad gateway",
		);
		down = false;
		expect(await app.token("acme/web")).toBe("ghs_x");
	});
});

import { createHash } from "node:crypto";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { grantsFile } from "../../src/connector/grants.js";
import {
	authorizationServer,
	pkceMatches,
	protectedResource,
	readAccess,
	redirectTarget,
	refreshHash,
	signAccess,
	tokenKey,
} from "../../src/connector/oauth.js";

const STUDIO = new URL("https://factory.example.com");

describe("metadata", () => {
	it("names the connector's URL as the resource, and the studio as its authorization server", () => {
		expect(protectedResource(STUDIO)).toMatchObject({
			resource: "https://factory.example.com/mcp",
			authorization_servers: ["https://factory.example.com"],
		});
		expect(authorizationServer(STUDIO)).toMatchObject({
			issuer: "https://factory.example.com",
			authorization_endpoint: "https://factory.example.com/oauth/authorize",
			token_endpoint: "https://factory.example.com/oauth/token",
			registration_endpoint: "https://factory.example.com/oauth/register",
			code_challenge_methods_supported: ["S256"],
			token_endpoint_auth_methods_supported: ["none"],
		});
	});
});

describe("redirectTarget", () => {
	it("knows Claude's callback and Claude Code's loopback, nothing else", () => {
		expect(redirectTarget("https://claude.ai/api/mcp/auth_callback")).toBe(
			"Claude",
		);
		for (const loopback of [
			"http://localhost:3118/callback",
			"http://127.0.0.1:50000/callback",
		])
			expect(redirectTarget(loopback)).toBe("Claude Code on this computer");
		for (const other of [
			"https://claude.ai/api/mcp/auth_callback?x=1",
			"https://claude.ai/other",
			"https://evil.example/api/mcp/auth_callback",
			"http://claude.ai/api/mcp/auth_callback",
			"https://localhost/callback",
			"http://localhost.evil.example/callback",
			"http://127.0.0.1@evil.example/callback",
			"http://localhost:3118/callback#x",
			"not a url",
			"",
		])
			expect(redirectTarget(other), other).toBeUndefined();
	});
});

describe("pkceMatches", () => {
	const verifier = "a".repeat(43);
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	it("checks the verifier against the S256 challenge", () => {
		expect(pkceMatches(verifier, challenge)).toBe(true);
		expect(pkceMatches("b".repeat(43), challenge)).toBe(false);
	});
	it("refuses a verifier that is not 43 to 128 unreserved characters", () => {
		const short = "a".repeat(42);
		expect(
			pkceMatches(
				short,
				createHash("sha256").update(short).digest("base64url"),
			),
		).toBe(false);
		const spaced = `${"a".repeat(42)} `;
		expect(
			pkceMatches(
				spaced,
				createHash("sha256").update(spaced).digest("base64url"),
			),
		).toBe(false);
	});
});

describe("access tokens", () => {
	const key = tokenKey("correct horse battery staple");
	const now = 1_800_000_000_000;
	it("carry their grant until they expire, an hour later", () => {
		const token = signAccess(key, "g1", now);
		expect(readAccess(key, token, now)).toBe("g1");
		expect(readAccess(key, token, now + 3599_000)).toBe("g1");
		expect(readAccess(key, token, now + 3600_000)).toBeUndefined();
	});
	it("are worth nothing once changed, or under another password", () => {
		const token = signAccess(key, "g1", now);
		const [payload, mac] = token.split(".");
		const forged = `${Buffer.from(JSON.stringify({ grant: "g2", exp: 9e9 })).toString("base64url")}.${mac}`;
		expect(readAccess(key, forged, now)).toBeUndefined();
		expect(readAccess(key, `${payload}.`, now)).toBeUndefined();
		expect(readAccess(key, "nonsense", now)).toBeUndefined();
		expect(
			readAccess(tokenKey("another long password"), token, now),
		).toBeUndefined();
	});
});

describe("grantsFile", () => {
	const key = tokenKey("correct horse battery staple");
	const path = () =>
		join(mkdtempSync(join(tmpdir(), "openfabriq-grants-")), "grants.json");
	const day = 24 * 3600_000;

	it("keeps a grant, readable by this user only, and swaps its refresh token once", () => {
		const file = path();
		const grants = grantsFile(file);
		const id = grants.add(refreshHash(key, "r1"), "client", 0);
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(grants.has(id, 0)).toBe(true);
		const rotated = grants.rotate(
			refreshHash(key, "r1"),
			refreshHash(key, "r2"),
			day,
		);
		expect(rotated).toBe(id);
		// Used: past a short grace, the old refresh token is worth nothing.
		expect(
			grants.rotate(
				refreshHash(key, "r1"),
				refreshHash(key, "r3"),
				day + 2 * 60_000,
			),
		).toBeUndefined();
		// Read again from the file, as after a restart.
		expect(
			grantsFile(file).rotate(
				refreshHash(key, "r2"),
				refreshHash(key, "r3"),
				2 * day,
			),
		).toBe(id);
	});

	it("lets two clients that share a refresh token renew it at once, each keeping its own", () => {
		const h = (token: string) => refreshHash(key, token);
		const grants = grantsFile(path());
		const id = grants.add(h("r0"), "client", 0);
		// Two Claude Code sessions hold r0; the first renews it, the second a minute later.
		expect(grants.rotate(h("r0"), h("a1"), day)).toBe(id);
		expect(grants.rotate(h("r0"), h("b1"), day + 60_000)).toBe(id);
		// Both new tokens stay good, an hour later and beyond.
		expect(grants.rotate(h("a1"), h("a2"), day + 3600_000)).toBe(id);
		expect(grants.rotate(h("b1"), h("b2"), day + 3600_000)).toBe(id);
		// Once each: the second use of a1 comes after the grace.
		expect(grants.rotate(h("a1"), h("a3"), day + 2 * 3600_000)).toBeUndefined();
	});

	it("keeps a few refresh tokens per grant at most", () => {
		const h = (token: string) => refreshHash(key, token);
		const grants = grantsFile(path());
		const id = grants.add(h("r0"), "client", 0);
		expect(grants.rotate(h("r0"), h("c0"), 0)).toBe(id);
		for (let i = 1; i <= 5; i++)
			expect(grants.rotate(h("r0"), h(`c${i}`), 0)).toBe(id);
		// The oldest went first.
		expect(grants.rotate(h("c0"), h("x"), 0)).toBeUndefined();
		expect(grants.rotate(h("c5"), h("y"), 0)).toBe(id);
	});

	it("drops a grant 30 days after its last use", () => {
		const grants = grantsFile(path());
		const id = grants.add(refreshHash(key, "r1"), "client", 0);
		expect(grants.has(id, 30 * day - 1)).toBe(true);
		expect(grants.has(id, 30 * day)).toBe(false);
		expect(
			grants.rotate(refreshHash(key, "r1"), refreshHash(key, "r2"), 30 * day),
		).toBeUndefined();
	});

	it("starts empty without a file, or with one it cannot read", () => {
		expect(grantsFile(path()).has("g", 0)).toBe(false);
	});
});

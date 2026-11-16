import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { studioAccess } from "../../src/access/env.js";
import { clientAddress, failedLogins } from "../../src/access/login.js";
import { allowedHost, allowedOrigin } from "../../src/access/origin.js";
import { cookieName, sameToken } from "../../src/access/session.js";

const PASSWORD = "correct horse battery staple";
const URL_ = "https://factory.example.com";

describe("studioAccess", () => {
	it("is the token alone without the variables, or with them empty (docker compose passes them empty)", () => {
		expect(studioAccess({})).toEqual({});
		expect(
			studioAccess({
				OPENFABRIQ_STUDIO_PASSWORD: "",
				OPENFABRIQ_STUDIO_URL: "",
			}),
		).toEqual({});
	});

	it("takes a password of 16 characters or more", () => {
		expect(studioAccess({ OPENFABRIQ_STUDIO_PASSWORD: PASSWORD })).toEqual({
			password: PASSWORD,
		});
		expect(() =>
			studioAccess({ OPENFABRIQ_STUDIO_PASSWORD: "short-password1" }),
		).toThrow(/16 characters/);
	});

	it("takes an https address with the password only", () => {
		const access = studioAccess({
			OPENFABRIQ_STUDIO_PASSWORD: PASSWORD,
			OPENFABRIQ_STUDIO_URL: `${URL_}/`,
		});
		expect(access.url?.origin).toBe(URL_);
		expect(() => studioAccess({ OPENFABRIQ_STUDIO_URL: URL_ })).toThrow(
			/OPENFABRIQ_STUDIO_PASSWORD/,
		);
	});

	it("refuses an address that is not a bare https origin", () => {
		for (const url of [
			"http://factory.example.com",
			"factory.example.com",
			"https://factory.example.com/studio",
			"https://factory.example.com/?a=b",
			"https://user:pass@factory.example.com",
			"https://factory.example.com/#x",
		])
			expect(
				() =>
					studioAccess({
						OPENFABRIQ_STUDIO_PASSWORD: PASSWORD,
						OPENFABRIQ_STUDIO_URL: url,
					}),
				url,
			).toThrow(/OPENFABRIQ_STUDIO_URL/);
	});
});

describe("allowedHost", () => {
	const url = new URL(URL_);
	it("accepts this server's own names, and the studio's address when there is one", () => {
		expect(allowedHost("127.0.0.1:4310", 4310)).toBe(true);
		expect(allowedHost("localhost:4310", 4310)).toBe(true);
		expect(allowedHost("factory.example.com", 4310, url)).toBe(true);
		expect(
			allowedHost("factory.example.com:8443", 4310, new URL(`${URL_}:8443`)),
		).toBe(true);
	});

	it("refuses any other", () => {
		for (const host of [
			undefined,
			"factory.example.com",
			"evil.example",
			"127.0.0.1:1",
		])
			expect(allowedHost(host, 4310), host).toBe(false);
		for (const host of [
			"factory.example.com:4310",
			"evil.example",
			"factory.example.com.evil.example",
		])
			expect(allowedHost(host, 4310, url), host).toBe(false);
	});
});

describe("allowedOrigin", () => {
	const url = new URL(URL_);
	it("accepts no Origin, or the one of the Host the request came through", () => {
		expect(allowedOrigin(undefined, "127.0.0.1:4310")).toBe(true);
		expect(allowedOrigin("http://127.0.0.1:4310", "127.0.0.1:4310", url)).toBe(
			true,
		);
		expect(allowedOrigin(URL_, "factory.example.com", url)).toBe(true);
	});

	it("refuses another site, plain http on the studio's address, and the studio's origin through another Host", () => {
		expect(
			allowedOrigin("https://evil.example", "factory.example.com", url),
		).toBe(false);
		expect(
			allowedOrigin("http://factory.example.com", "factory.example.com", url),
		).toBe(false);
		expect(allowedOrigin(URL_, "127.0.0.1:4310", url)).toBe(false);
		expect(allowedOrigin(URL_, "factory.example.com")).toBe(false);
	});
});

it("compares passwords and tokens whatever their length and their characters", () => {
	expect(sameToken(PASSWORD, PASSWORD)).toBe(true);
	expect(sameToken(`${PASSWORD}x`, PASSWORD)).toBe(false);
	expect(sameToken("", PASSWORD)).toBe(false);
	// As many characters as the token, more bytes: refused, never thrown.
	expect(sameToken(`é${"a".repeat(63)}`, "a".repeat(64))).toBe(false);
});

it("names each studio's cookie after its port: two engines side by side keep their own", () => {
	expect(cookieName(4310)).toBe("openfabriq-4310");
	expect(cookieName(4311)).not.toBe(cookieName(4310));
});

it("blocks an address after 10 failures in 10 minutes, until the window empties, and not the others", () => {
	const failures = failedLogins();
	const t0 = 1_000_000;
	for (let i = 0; i < 9; i++) failures.add(t0 + i, "203.0.113.7");
	expect(failures.blocked(t0 + 10, "203.0.113.7")).toBe(false);
	failures.add(t0 + 9, "203.0.113.7");
	expect(failures.blocked(t0 + 10, "203.0.113.7")).toBe(true);
	expect(failures.blocked(t0 + 10, "198.51.100.1")).toBe(false);
	expect(failures.blocked(t0 + 10 * 60_000 - 1, "203.0.113.7")).toBe(true);
	expect(failures.blocked(t0 + 10 * 60_000, "203.0.113.7")).toBe(false);
});

it("blocks everyone after 100 failures in 10 minutes, whatever the addresses", () => {
	const failures = failedLogins();
	for (let i = 0; i < 99; i++) failures.add(i, `10.0.0.${i}`);
	expect(failures.blocked(100, "10.0.1.1")).toBe(false);
	failures.add(100, "10.0.0.200");
	expect(failures.blocked(101, "10.0.1.1")).toBe(true);
});

describe("clientAddress", () => {
	const url = new URL(URL_);
	const req = (headers: Record<string, string | string[]>) =>
		({ headers }) as unknown as IncomingMessage;
	it("is the last address of X-Forwarded-For on the studio's domain: the one the proxy added", () => {
		expect(
			clientAddress(
				req({
					host: "factory.example.com",
					"x-forwarded-for": "1.2.3.4, 203.0.113.7",
				}),
				url,
			),
		).toBe("203.0.113.7");
	});

	it("is local on 127.0.0.1, without the header, or without the studio's address", () => {
		expect(
			clientAddress(
				req({ host: "127.0.0.1:4310", "x-forwarded-for": "203.0.113.7" }),
				url,
			),
		).toBe("local");
		expect(clientAddress(req({ host: "factory.example.com" }), url)).toBe(
			"local",
		);
		expect(
			clientAddress(
				req({ host: "factory.example.com", "x-forwarded-for": "203.0.113.7" }),
			),
		).toBe("local");
	});
});

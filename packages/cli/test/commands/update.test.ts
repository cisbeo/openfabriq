import { expect, it } from "vitest";
import {
	isNewer,
	latestVersion,
	type UpdateDeps,
	updateCommand,
	updateNotice,
} from "../../src/commands/update.js";

const deps = (over: Partial<UpdateDeps> = {}): UpdateDeps => ({
	kind: "npm",
	current: "0.1.0",
	latest: async () => "0.2.0",
	install: async () => "",
	sources: "/code/openfabriq",
	...over,
});

it("compares versions number by number, and never calls a pre-release newer", () => {
	expect(isNewer("0.2.0", "0.1.0")).toBe(true);
	expect(isNewer("0.10.0", "0.9.3")).toBe(true);
	expect(isNewer("1.0.0", "1.0.0")).toBe(false);
	expect(isNewer("0.1.0", "0.2.0")).toBe(false);
	expect(isNewer("0.3.0-beta.1", "0.2.0")).toBe(false);
	expect(isNewer("garbage", "0.2.0")).toBe(false);
});

it("installs the latest version from npm when there is one", async () => {
	const installed: string[] = [];
	const result = await updateCommand(
		deps({
			install: async () => {
				installed.push("npm");
				return "";
			},
		}),
	);
	expect(installed).toEqual(["npm"]);
	expect(result).toEqual({
		code: 0,
		output:
			'openfabriq 0.2.0 installed (was 0.1.0). If "openfabriq start" runs, restart it.',
	});
});

it("says when it is up to date, or when npm cannot be reached, and installs nothing", async () => {
	const never = async () => {
		throw new Error("should not install");
	};
	expect(
		await updateCommand(deps({ latest: async () => "0.1.0", install: never })),
	).toEqual({
		code: 0,
		output: "openfabriq 0.1.0 is the latest version.",
	});
	expect(
		(
			await updateCommand(
				deps({ latest: async () => undefined, install: never }),
			)
		).code,
	).toBe(1);
});

it("says how to update when openfabriq came from its sources or runs in Docker", async () => {
	const never = async () => {
		throw new Error("should not install");
	};
	expect(
		(await updateCommand(deps({ kind: "sources", install: never }))).output,
	).toBe(
		"This openfabriq runs from its sources in /code/openfabriq: run git pull && pnpm install && pnpm build there.",
	);
	expect(
		(await updateCommand(deps({ kind: "docker", install: never }))).output,
	).toBe(
		"In Docker, update the image: git pull && docker compose up -d --build, in openfabriq's folder.",
	);
});

it("says what npm said when it cannot install", async () => {
	const result = await updateCommand(
		deps({
			install: async () => {
				throw new Error("EACCES: permission denied");
			},
		}),
	);
	expect(result.code).toBe(1);
	expect(result.output).toContain("EACCES: permission denied");
	expect(result.output).toContain(
		"sudo npm install --global openfabriq@latest",
	);
});

it("upgrades with Homebrew when the formula installed it", async () => {
	const ran: string[] = [];
	const result = await updateCommand(
		deps({
			kind: "homebrew",
			install: async () => {
				ran.push("brew");
				return "";
			},
		}),
	);
	expect(ran).toEqual(["brew"]);
	expect(result.output).toContain("Homebrew upgraded openfabriq");
});

it("tells start about a new version, only for an npm or Homebrew install", async () => {
	expect(await updateNotice(deps())).toBe(
		"openfabriq 0.2.0 is out (this is 0.1.0): run openfabriq update",
	);
	expect(
		await updateNotice(deps({ latest: async () => "0.1.0" })),
	).toBeUndefined();
	expect(await updateNotice(deps({ kind: "homebrew" }))).toBeDefined();
	expect(await updateNotice(deps({ kind: "sources" }))).toBeUndefined();
	expect(await updateNotice(deps({ kind: "docker" }))).toBeUndefined();
});

it("reads the latest version from the npm registry, and nothing on a failure", async () => {
	expect(
		await latestVersion(async () => Response.json({ version: "0.3.1" })),
	).toBe("0.3.1");
	expect(
		await latestVersion(async () => new Response("nope", { status: 500 })),
	).toBeUndefined();
	expect(
		await latestVersion(async () => {
			throw new Error("offline");
		}),
	).toBeUndefined();
});

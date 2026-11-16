import { beforeEach, describe, expect, it, vi } from "vitest";

// The gh adapter in app mode: each call carries its repository's installation token.
const calls: { args: string[]; token?: string | undefined }[] = [];
let answer: (args: string[], token?: string) => unknown = () => ({});
const forgotten: string[] = [];
let minted = 0;
vi.mock("../../src/exec.js", () => ({
	exec: async (
		_command: string,
		args: string[],
		options: { env?: NodeJS.ProcessEnv } = {},
	) => {
		calls.push({ args, token: options.env?.GH_TOKEN });
		return JSON.stringify(answer(args, options.env?.GH_TOKEN));
	},
}));
vi.mock("../../src/github/app.js", () => ({
	githubApp: () => ({
		login: async () => "acme-factory[bot]",
		forget: (repository: string) => {
			forgotten.push(repository);
			minted++;
		},
	}),
	githubEnv: async (repository: string) => ({
		GH_TOKEN: `token-of-${repository}${minted ? `-${minted}` : ""}`,
	}),
}));

let gh: typeof import("../../src/github/gh.js").gh;
beforeEach(async () => {
	vi.resetModules();
	({ gh } = await import("../../src/github/gh.js"));
	calls.length = 0;
	forgotten.length = 0;
	minted = 0;
	answer = () => ({});
});

describe("gh in app mode", () => {
	it("gives each call its repository's token, gh api and gh pr alike", async () => {
		answer = (args) =>
			args[0] === "pr"
				? [
						{
							number: 1,
							headRefOid: "a",
							author: { login: "app/acme-factory", is_bot: true },
						},
					]
				: { default_branch: "main" };
		await gh.defaultBranch("acme/web");
		const pulls = await gh.openPulls("acme/api");
		expect(calls.map((c) => c.token)).toEqual([
			"token-of-acme/web",
			"token-of-acme/api",
		]);
		// GraphQL's app/<slug> becomes REST's <slug>[bot], the engine's own login.
		expect(pulls[0]?.author).toBe("acme-factory[bot]");
	});

	it("is the app's bot, without asking gh api user (an installation token has no user)", async () => {
		expect(await gh.currentUser()).toBe("acme-factory[bot]");
		expect(calls).toEqual([]);
	});

	it("names the author of a subject as REST does", async () => {
		answer = () => ({ number: 3, author: { login: "app/acme-factory" } });
		const subject = await gh.subject("acme/web", 3, true);
		expect(subject.author).toEqual({ login: "acme-factory[bot]" });
	});

	it("forgets a revoked token once and tries again with a new one, as after the app was installed again", async () => {
		answer = (_args, token) => {
			if (token === "token-of-acme/web")
				throw new Error(
					"gh: HTTP 401: Bad credentials (https://api.github.com/repos/acme/web)",
				);
			return { default_branch: "main" };
		};
		expect(await gh.defaultBranch("acme/web")).toBe("main");
		expect(forgotten).toEqual(["acme/web"]);
		expect(calls.map((c) => c.token)).toEqual([
			"token-of-acme/web",
			"token-of-acme/web-1",
		]);
	});

	it("does not try again on another error", async () => {
		answer = () => {
			throw new Error("gh: HTTP 404: Not Found");
		};
		await expect(gh.defaultBranch("acme/web")).rejects.toThrow("404");
		expect(forgotten).toEqual([]);
		expect(calls).toHaveLength(1);
	});
});

import { expect, it } from "vitest";
import { repositoryOfRemote } from "../../src/workspace/git.js";

it("reads owner/name from origin's URL, whatever its form", () => {
	for (const url of [
		"https://github.com/acme/web-app.git",
		"https://github.com/acme/web-app",
		"git@github.com:acme/web-app.git",
		"ssh://git@github.com/acme/web-app.git",
		"https://x-access-token:t@github.example.com/acme/web-app.git\n",
	])
		expect([url, repositoryOfRemote(url)]).toEqual([url, "acme/web-app"]);
	expect(repositoryOfRemote("/srv/git/web-app")).toBe("git/web-app");
	expect(repositoryOfRemote("")).toBeUndefined();
});

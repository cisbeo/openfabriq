import { expect, it } from "vitest";
import { namedProjects } from "../src/projects.js";

it("finds the project --project names whatever its case", () => {
	expect(namedProjects(["acme/app", "acme/web"], "Acme/App")).toEqual([
		"acme/app",
	]);
	expect(namedProjects(["acme/app", "acme/web"], undefined)).toEqual([
		"acme/app",
		"acme/web",
	]);
});

it("takes the one written the same way when two differ only by case", () => {
	// On a case-sensitive disk, applying acme/app then Acme/App leaves both folders.
	expect(namedProjects(["acme/app", "Acme/App"], "Acme/App")).toEqual([
		"Acme/App",
	]);
	expect(namedProjects(["acme/app", "Acme/App"], "ACME/APP")).toEqual([
		"acme/app",
		"Acme/App",
	]);
});

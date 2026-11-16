import { expect, it } from "vitest";
import {
	agentHref,
	boardHref,
	chooseProject,
	crumbDetail,
	crumbs,
	menuPageOf,
	overviewHref,
	pageHref,
	pageTitle,
	projectSwitchHref,
	readHash,
	runHref,
	runsHref,
	settingsHref,
	waitsForProjects,
	wikiHref,
	withProject,
} from "../../../app/src/lib/route.js";

it("reads the page, its path and its parameters from the hash", () => {
	const { path, params } = readHash("#/run/a%2Fb?project=acme%2Fshop&tab=logs");
	expect(path).toEqual(["run", "a/b"]);
	expect(params.get("project")).toBe("acme/shop");
	expect(params.get("tab")).toBe("logs");
	expect(readHash("").path).toEqual([]);
});

it("links to a run's page, its id encoded, without empty parameters", () => {
	expect(runHref("a/b c")).toBe("#/run/a%2Fb%20c");
	expect(runHref("r1", { project: "acme/shop", tab: "outputs" })).toBe(
		"#/run/r1?project=acme%2Fshop&tab=outputs",
	);
	expect(runHref("r1", { project: undefined, tab: "logs" })).toBe(
		"#/run/r1?tab=logs",
	);
});

it("links to an agent's page in the project", () => {
	expect(agentHref("code review", "acme/shop")).toBe(
		"#/agents/code%20review?project=acme%2Fshop",
	);
	expect(agentHref("triage", undefined)).toBe("#/agents/triage");
});

it("links to a tab of the factory's settings", () => {
	expect(settingsHref("acme/shop", "limits")).toBe(
		"#/settings?project=acme%2Fshop&tab=limits",
	);
	expect(settingsHref(undefined)).toBe("#/settings");
});

it("names what is open after the page in the breadcrumb", () => {
	const none = new URLSearchParams();
	expect(crumbDetail(["run", "r1"], none)).toBe("r1");
	expect(crumbDetail(["agents"], none)).toBeUndefined();
	expect(crumbDetail([], none)).toBe("Productivity");
	expect(crumbDetail(["overview"], new URLSearchParams("view=cost"))).toBe(
		"Cost and return",
	);
	expect(crumbDetail(["board"], none)).toBeUndefined();
});

it("leads each step of the breadcrumb but the last back up, in the project", () => {
	expect(crumbs("acme/shop", { id: "runs", label: "Runs" }, "r1")).toEqual([
		{ label: "acme/shop", href: "#/overview?project=acme%2Fshop" },
		{ label: "Runs", href: "#/runs?project=acme%2Fshop" },
		{ label: "r1" },
	]);
	expect(crumbs(undefined, { id: "board", label: "Board" }, undefined)).toEqual(
		[
			{ label: "No project", href: "#/overview" },
			{ label: "Board", href: "#/board" },
		],
	);
});

it("titles the tab with what is open first, then the page", () => {
	expect(pageTitle("Runs", "r1")).toBe("r1 · Runs · openfabriq");
	expect(pageTitle("Board", undefined)).toBe("Board · openfabriq");
});

it("shows one project at a time: the one asked, else the last one chosen, else the first", () => {
	const projects = ["acme/api", "acme/web"];
	expect(chooseProject("acme/web", projects, "acme/api")).toBe("acme/web");
	expect(chooseProject(undefined, projects, "acme/web")).toBe("acme/web");
	expect(chooseProject("gone/repo", projects, "gone/too")).toBe("acme/api");
	expect(chooseProject(undefined, [], "acme/web")).toBeUndefined();
});

it("puts the project in the address and keeps the rest of it", () => {
	const { path, params } = readHash("#/run/a%2Fb?tab=logs");
	expect(withProject(path, params, "acme/web")).toBe(
		"#/run/a%2Fb?tab=logs&project=acme%2Fweb",
	);
	expect(withProject([], new URLSearchParams(), "acme/web")).toBe(
		"#/overview?project=acme%2Fweb",
	);
});

it("puts a run's page under Runs in the menu", () => {
	expect(menuPageOf("run")).toBe("runs");
	expect(menuPageOf("agents")).toBe("agents");
	expect(menuPageOf("overview")).toBe("overview");
});

it("waits for the projects on the pages that need them, and without a project", () => {
	for (const page of ["agents", "chat", "workflow", "wiki", "settings"])
		expect(waitsForProjects(page, undefined, "acme/shop")).toBe(true);
	expect(waitsForProjects("runs", undefined, "acme/shop")).toBe(false);
	expect(waitsForProjects("runs", undefined, undefined)).toBe(true);
	expect(waitsForProjects("chat", [], undefined)).toBe(false);
	expect(waitsForProjects("overview", ["acme/shop"], "acme/shop")).toBe(false);
});

it("links to each page with its own parameters, in their order, without the empty ones", () => {
	const project = "acme/shop";
	expect(runsHref({ project, agent: "reviewer", status: "failed" })).toBe(
		"#/runs?project=acme%2Fshop&agent=reviewer&status=failed",
	);
	expect(runsHref({ project: undefined, status: "failed" })).toBe(
		"#/runs?status=failed",
	);
	expect(boardHref({ project, agent: "a b" })).toBe(
		"#/board?project=acme%2Fshop&agent=a+b",
	);
	expect(overviewHref({ project, period: "30d", view: "cost" })).toBe(
		"#/overview?project=acme%2Fshop&period=30d&view=cost",
	);
	expect(wikiHref({ project, page: "a/b.md", find: "two words" })).toBe(
		"#/wiki?project=acme%2Fshop&page=a%2Fb.md&find=two+words",
	);
	expect(pageHref("agents", project)).toBe("#/agents?project=acme%2Fshop");
	expect(pageHref("chat", undefined)).toBe("#/chat");
});

it("goes to the same page of another project, keeping only what means the same there", () => {
	const params = (search: string) => new URLSearchParams(search);
	expect(
		projectSwitchHref(
			"overview",
			params("project=a&period=30d&view=cost"),
			"b",
		),
	).toBe("#/overview?project=b&period=30d&view=cost");
	expect(
		projectSwitchHref(
			"runs",
			params("project=a&agent=reviewer&status=failed"),
			"b",
		),
	).toBe("#/runs?project=b&status=failed");
	expect(projectSwitchHref("run", params("project=a&tab=logs"), "b")).toBe(
		"#/runs?project=b",
	);
	expect(
		projectSwitchHref("wiki", params("project=a&page=x.md&find=y"), "b"),
	).toBe("#/wiki?project=b");
});

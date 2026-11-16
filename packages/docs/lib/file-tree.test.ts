import { describe, expect, it } from "vitest";
import {
	closedAllBut,
	closeFolder,
	fileOf,
	foldersIn,
	foldersOf,
	rowsOf,
	visibleRows,
} from "./file-tree";

const PATHS = [
	"factory.yaml",
	"agents/implementer/agent.md",
	"agents/implementer/skills/test-first/SKILL.md",
	"agents/investigator/agent.md",
	"automations/implement-ready-issues/automation.md",
	"skills/writing-for-maintainers/SKILL.md",
];

describe("file tree", () => {
	it("lists the folders that hold a path, outermost first", () => {
		expect(foldersOf("agents/implementer/agent.md")).toEqual([
			"agents",
			"agents/implementer",
		]);
		expect(foldersOf("factory.yaml")).toEqual([]);
		expect(foldersIn(PATHS)).toHaveLength(9);
	});

	it("draws each folder once, before its files", () => {
		expect(
			rowsOf(PATHS)
				.slice(0, 6)
				.map((r) => `${"  ".repeat(r.depth)}${r.name}`),
		).toEqual([
			"factory.yaml",
			"agents/",
			"  implementer/",
			"    agent.md",
			"    skills/",
			"      test-first/",
		]);
	});

	it("hides what a closed folder holds", () => {
		const closed = closedAllBut(PATHS, "agents/investigator/agent.md");
		expect(visibleRows(PATHS, closed).map((r) => r.path)).toEqual([
			"factory.yaml",
			"agents",
			"agents/implementer",
			"agents/investigator",
			"agents/investigator/agent.md",
			"automations",
			"skills",
		]);
	});

	it("opens one branch at a time, and closes a folder with what it holds", () => {
		const open = closedAllBut(PATHS, "agents/implementer/skills");
		expect(open.has("agents")).toBe(false);
		expect(open.has("agents/implementer/skills")).toBe(false);
		expect(open.has("agents/implementer/skills/test-first")).toBe(true);
		expect([...closeFolder(PATHS, new Set(), "agents/implementer")]).toEqual([
			"agents/implementer",
			"agents/implementer/skills",
			"agents/implementer/skills/test-first",
		]);
	});

	it("finds the file a folder leads to, through an only subfolder", () => {
		expect(fileOf(PATHS, "agents/implementer")).toBe(
			"agents/implementer/agent.md",
		);
		expect(fileOf(PATHS, "skills")).toBe(
			"skills/writing-for-maintainers/SKILL.md",
		);
		expect(fileOf(PATHS, "agents")).toBeUndefined();
	});
});

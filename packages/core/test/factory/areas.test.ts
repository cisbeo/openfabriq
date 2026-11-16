import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resourceFolder } from "../../src/factory/files.js";
import { loadFactory } from "../../src/factory/load.js";
import type { FactoryFiles } from "../../src/factory/types.js";
import { planChanges } from "../../src/plan/plan.js";
import { fileChanges } from "../../src/plan/topics/files.js";
import { load, ROOT, readFolder } from "../helpers.js";

const areas = () => readFolder(join(ROOT, "fixtures/valid/areas/openfabriq"));

const FACTORY = "name: F\nrepository: acme/app\nmaintainers: [alice]\n";
const AGENT = "---\ndescription: Does things\n---\nDo things.\n";
const AUTOMATION = (agent: string) =>
	`---\nwhen: [issue.opened]\nagent: ${agent}\ncan: [add_comment]\n---\nGo.\n`;
const SKILL = "---\nname: s\ndescription: A skill\n---\nDo it well.\n";

const messages = (files: FactoryFiles) =>
	loadFactory(files).problems.map((p) => `${p.file}: ${p.message}`);

describe("a factory ordered by area", () => {
	it("loads its agents and automations by name, each with its area", () => {
		const { factory, problems } = loadFactory(areas());
		expect(problems).toEqual([]);
		expect(factory?.agents.triage?.area).toBeUndefined();
		expect(factory?.agents.tester?.area).toBe("qa");
		expect(factory?.agents.auditor?.area).toBe("security");
		expect(factory?.automations["triage-issues"]?.area).toBeUndefined();
		expect(factory?.automations["test-new-prs"]?.area).toBe("qa");
		expect(factory?.automations["nightly-audit"]?.area).toBe("security");
	});

	it("keeps the shared skills, an area's skills and an agent's own apart", () => {
		const factory = load(areas());
		expect(factory.skills).toEqual(["conventions"]);
		expect(factory.areaSkills).toEqual({ security: ["owasp"] });
		expect(factory.agents.auditor?.skills).toEqual(["report"]);
		expect(factory.agents.tester?.skills).toEqual([]);
	});

	it("lets an automation start the agent of another area", () => {
		const factory = load(areas());
		expect(factory.automations["review-dependency-changes"]).toMatchObject({
			area: "security",
			agent: "tester",
		});
	});

	it("has no area skills when no area has skills", () => {
		const files = areas();
		delete files["security/skills/owasp/SKILL.md"];
		expect(load(files).areaSkills).toBeUndefined();
	});

	it("says where each resource's folder is", () => {
		expect(resourceFolder("agents", "tester", "qa")).toBe("qa/agents/tester");
		expect(resourceFolder("automations", "triage-issues")).toBe(
			"automations/triage-issues",
		);
	});
});

describe("the folders of areas", () => {
	it("refuses two agents of the same name, naming both folders", () => {
		expect(
			messages({
				"factory.yaml": FACTORY,
				"qa/agents/reviewer/agent.md": AGENT,
				"security/agents/reviewer/agent.md": AGENT,
				"qa/automations/a/automation.md": AUTOMATION("reviewer"),
			}),
		).toContain(
			"security/agents/reviewer: an agent named reviewer is already in qa/agents/reviewer: names are unique in the whole factory. Rename one, like security-reviewer",
		);
	});

	it("refuses two automations of the same name, one at the root", () => {
		expect(
			messages({
				"factory.yaml": FACTORY,
				"agents/worker/agent.md": AGENT,
				"automations/check/automation.md": AUTOMATION("worker"),
				"qa/automations/check/automation.md": AUTOMATION("worker"),
			}),
		).toContain(
			"qa/automations/check: an automation named check is already in automations/check: names are unique in the whole factory. Rename one, like qa-check",
		);
	});

	it("refuses an area whose name the engine cannot read", () => {
		expect(
			messages({
				"factory.yaml": FACTORY,
				"Big QA/agents/worker/agent.md": AGENT,
				"Big QA/automations/a/automation.md": AUTOMATION("worker"),
			}),
		).toContain(
			"Big QA: an area's name is its folder's: lowercase letters, digits and -, like qa",
		);
	});

	it("refuses an agent two folders deep", () => {
		expect(
			messages({
				"factory.yaml": FACTORY,
				"agents/worker/agent.md": AGENT,
				"automations/a/automation.md": AUTOMATION("worker"),
				"teams/qa/agents/tester/agent.md": AGENT,
			}),
		).toContain(
			"teams/qa/agents/tester/agent.md: an area is one folder under openfabriq/: move it to qa/agents/tester/agent.md",
		);
	});

	it("says a flat file in an area is a folder", () => {
		expect(
			messages({
				"factory.yaml": FACTORY,
				"qa/agents/tester.md": AGENT,
				"qa/automations/a/automation.md": AUTOMATION("tester"),
			}),
		).toContain(
			"qa/agents/tester.md: an agent is a folder: move it to qa/agents/tester/agent.md",
		);
	});

	it("says what an area's folders miss", () => {
		const found = messages({
			"factory.yaml": FACTORY,
			"agents/worker/agent.md": AGENT,
			"automations/a/automation.md": AUTOMATION("worker"),
			"qa/agents/tester/notes.md": "notes",
			"qa/skills/owasp/notes.md": "notes",
		});
		expect(found).toContain(
			"qa/agents/tester: missing qa/agents/tester/agent.md",
		);
		expect(found).toContain(
			"qa/skills/owasp: missing qa/skills/owasp/SKILL.md",
		);
	});

	it("leaves the scripts' folders and others without agents alone", () => {
		expect(
			messages({
				"factory.yaml": FACTORY,
				"agents/worker/agent.md": AGENT,
				"automations/a/automation.md": AUTOMATION("worker"),
				"scripts/skills/x/run.sh": "#!/bin/sh\n",
				"notes/skills/x/todo.md": "todo",
			}),
		).toEqual([]);
	});
});

describe("the plan of a factory ordered by area", () => {
	it("shows a resource moved into an area on one line, and nothing else", () => {
		const before = areas();
		const after = { ...before };
		after["agents/tester/agent.md"] = after["qa/agents/tester/agent.md"] ?? "";
		delete after["qa/agents/tester/agent.md"];
		const plan = planChanges(load(before), load(after), [], {
			before,
			after,
		});
		expect(plan.agents).toEqual(["~ tester: moved to agents/tester"]);
		expect(plan.security).toEqual([]);
		expect(plan.settings).toEqual([]);
	});

	it("counts an area's skill as a skill file, a security change", () => {
		const before = areas();
		const after = { ...before, "security/skills/owasp/SKILL.md": SKILL };
		expect(fileChanges(before, after).security).toEqual([
			"~ skill file security/skills/owasp/SKILL.md changed",
		]);
		const own = {
			...before,
			"security/agents/auditor/skills/report/SKILL.md": SKILL,
		};
		expect(fileChanges(before, own).security).toEqual([
			"~ skill file security/agents/auditor/skills/report/SKILL.md changed",
		]);
	});

	it("describes an area's agent.md in the plan, not as a file", () => {
		const before = areas();
		const after = {
			...before,
			"qa/agents/tester/agent.md": "---\ndescription: Tests\n---\nTest.\n",
		};
		expect(fileChanges(before, after)).toEqual({ security: [], settings: [] });
	});
});

import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, expect, it } from "vitest";
import { buildPlugin } from "../../src/workspace/plugin.js";

let factory: string;
let out: string;
const skill = (path: string) => {
	const file = join(factory, path, "SKILL.md");
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, "---\nname: s\ndescription: d\n---\nDo it.\n");
};
const skills = () => readdirSync(join(out, "skills")).sort();

beforeEach(() => {
	const root = mkdtempSync(join(tmpdir(), "openfabriq-plugin-"));
	factory = join(root, "factory");
	out = join(root, "plugin");
	skill("skills/conventions");
	skill("agents/triage/skills/labels");
	skill("security/skills/owasp");
	skill("security/agents/auditor/skills/report");
	skill("qa/skills/flaky-tests");
});

it("gives an agent at the root the shared skills and its own", () => {
	buildPlugin(factory, { name: "triage" }, out);
	expect(skills()).toEqual(["conventions", "labels"]);
});

it("gives an agent of an area the shared skills, its area's and its own, not another area's", () => {
	buildPlugin(factory, { name: "auditor", area: "security" }, out);
	expect(skills()).toEqual(["conventions", "owasp", "report"]);
});

it("has no plugin when there is no skill at all", () => {
	expect(
		buildPlugin(join(factory, "none"), { name: "triage" }, out),
	).toBeUndefined();
});

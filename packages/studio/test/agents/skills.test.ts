import { expect, it } from "vitest";
import { skillDocs } from "../../src/agents/skills.js";

const files = {
	"skills/conventions/SKILL.md":
		"---\nname: conventions\ndescription: Shared conventions for commits.\n---\n\n# Conventions\n\nKeep it short.\n",
	"agents/implementer/skills/testing/SKILL.md":
		'---\nname: testing\ndescription: "How to write tests here."\n---\nUse Vitest.\n',
	"agents/implementer/skills/testing/example.ts": "it()",
	"agents/reviewer/skills/review/SKILL.md": "No header at all.",
};

it("lists the skills an agent reads: its own first, then the shared ones, with their description", () => {
	expect(skillDocs(files, "implementer")).toEqual([
		{
			name: "testing",
			scope: "own",
			path: "agents/implementer/skills/testing/SKILL.md",
			description: "How to write tests here.",
			content: "Use Vitest.",
		},
		{
			name: "conventions",
			scope: "shared",
			path: "skills/conventions/SKILL.md",
			description: "Shared conventions for commits.",
			content: "# Conventions\n\nKeep it short.",
		},
	]);
});

it("keeps a skill without a header, with its text as content", () => {
	expect(skillDocs(files, "reviewer")[0]).toEqual({
		name: "review",
		scope: "own",
		path: "agents/reviewer/skills/review/SKILL.md",
		content: "No header at all.",
	});
});

it("gives an agent of an area its own skills, its area's, then the shared ones, each with its path", () => {
	const ordered = {
		"skills/conventions/SKILL.md": "---\nname: conventions\n---\nShort.\n",
		"security/agents/auditor/agent.md": "---\ndescription: d\n---\nAudit.\n",
		"security/agents/auditor/skills/report/SKILL.md": "One finding each.",
		"security/skills/owasp/SKILL.md": "The ten.",
		"qa/agents/tester/agent.md": "---\ndescription: d\n---\nTest.\n",
		"qa/skills/flaky/SKILL.md": "Retry once.",
	};
	expect(
		skillDocs(ordered, "auditor", "security").map((s) => [
			s.name,
			s.scope,
			s.path,
		]),
	).toEqual([
		["report", "own", "security/agents/auditor/skills/report/SKILL.md"],
		["owasp", "area", "security/skills/owasp/SKILL.md"],
		["conventions", "shared", "skills/conventions/SKILL.md"],
	]);
	expect(skillDocs(ordered, "tester", "qa").map((s) => s.name)).toEqual([
		"flaky",
		"conventions",
	]);
});

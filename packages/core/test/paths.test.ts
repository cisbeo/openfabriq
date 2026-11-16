import { expect, it } from "vitest";
import { matchesGlob, onlyIgnoredPaths } from "../src/paths.js";

it("matches * within a folder and ** across folders", () => {
	expect(matchesGlob("docs/a.md", "docs/*.md")).toBe(true);
	expect(matchesGlob("docs/deep/a.md", "docs/*.md")).toBe(false);
	expect(matchesGlob("openfabriq/agents/x/agent.md", "openfabriq/**")).toBe(
		true,
	);
	expect(matchesGlob("openfabriq.yaml", "openfabriq/**")).toBe(false);
	expect(matchesGlob("docs/a.md", "docs/**/a.md")).toBe(true);
	expect(matchesGlob("docs/x/y/a.md", "docs/**/a.md")).toBe(true);
	expect(matchesGlob("docs/xa.md", "docs/**/a.md")).toBe(false);
	expect(matchesGlob("README.md", "*.md")).toBe(true);
	expect(matchesGlob("src/README.md", "*.md")).toBe(false);
	expect(matchesGlob("src/a.ts", "**/*.ts")).toBe(true);
	expect(matchesGlob("a.ts", "**/*.ts")).toBe(true);
	// ? is one character, never a folder separator.
	expect(matchesGlob("a1.md", "a?.md")).toBe(true);
	expect(matchesGlob("a12.md", "a?.md")).toBe(false);
	expect(matchesGlob("a/.md", "a?.md")).toBe(false);
	// Regex characters are literal.
	expect(matchesGlob("a+b.md", "a+b.md")).toBe(true);
	expect(matchesGlob("axmd", "a.md")).toBe(false);
});

it("ignores a pull request only when every changed file matches", () => {
	const patterns = ["openfabriq/**", "docs/*.md"];
	expect(
		onlyIgnoredPaths(["openfabriq/factory.yaml", "docs/a.md"], patterns),
	).toBe(true);
	expect(
		onlyIgnoredPaths(["openfabriq/factory.yaml", "src/a.ts"], patterns),
	).toBe(false);
	expect(onlyIgnoredPaths([], patterns)).toBe(false);
});

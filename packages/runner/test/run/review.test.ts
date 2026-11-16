import { expect, it } from "vitest";
import { outsideWiki, workflowChange } from "../../src/run/outputs/review.js";

it("names every CI workflow the commits change, whatever its case", () => {
	expect(workflowChange(["src/a.ts", "docs/workflows/x.md"])).toBeUndefined();
	expect(workflowChange([".github/CODEOWNERS"])).toBeUndefined();
	expect(
		workflowChange([
			".github/workflows/ci.yml",
			".GitHub/Workflows/deploy.yml",
		]),
	).toBe(
		"the commits change .github/workflows/ci.yml, .GitHub/Workflows/deploy.yml: CI workflows run with the repository's secrets, so a person makes this change",
	);
});

it("keeps the wiki's commits in its folder", () => {
	expect(
		outsideWiki(["docs/wiki/index.md", "docs/wiki/areas/a.md"], "docs/wiki"),
	).toBeUndefined();
	expect(
		outsideWiki(
			["docs/wiki/index.md", "docs/wiki-x.md", "src/a.ts"],
			"docs/wiki",
		),
	).toBe(
		"the wiki's commits change docs/wiki-x.md, src/a.ts, outside docs/wiki/: the wiki's agent writes there only",
	);
});

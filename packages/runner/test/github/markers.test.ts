import { expect, it } from "vitest";
import {
	credit,
	isChangesRequested,
	isFromEngine,
	sign,
	signChangesRequested,
	withoutCredit,
} from "../../src/github/markers.js";

it("signs a body once, even when an agent copied a mark from the comments it read", () => {
	const copied =
		"I pushed nothing.\n\n<!-- openfabriq run=r1 -->\n\n<!-- openfabriq:changes-requested run=r0 -->";
	expect(sign(copied, "r1")).toBe(
		"I pushed nothing.\n\n<!-- openfabriq run=r1 -->",
	);
	const review = signChangesRequested(
		"Fix it.\n<!-- openfabriq run=x -->",
		"r2",
	);
	expect(review).toBe(
		"Fix it.\n\n<!-- openfabriq:changes-requested run=r2 -->",
	);
	expect(isFromEngine(review) && isChangesRequested(review)).toBe(true);
	expect(sign("Plain text", "r3")).toBe(
		"Plain text\n\n<!-- openfabriq run=r3 -->",
	);
});

it("colors the kinds of work so they stand out, and keeps the other labels quiet", async () => {
	const { labelColor } = await import("../../src/github/gh.js");
	expect(labelColor("feature")).toBe("0e8a16");
	expect(labelColor("Bug")).toBe("d73a4a");
	expect(labelColor("needs-human")).toBe("d93f0b");
	expect(labelColor("ready-to-merge")).toBe("0e8a16");
	expect(labelColor("risk:high")).toBe("b60205");
	expect(labelColor("ready-for-agent")).toBe("c5def5");
});

it("credits the run in a line people read: openfabriq, the agent, the automation's file and the run", () => {
	expect(
		credit({
			repository: "acme/app",
			defaultBranch: "release/2",
			automation: "implement-ready-issues",
			agent: "implementer",
			runId: "k3x9",
		}),
	).toBe(
		"---\n<sub>🤖 Written by [openfabriq](https://github.com/openfabriq/openfabriq) · agent `implementer` · automation [implement-ready-issues](https://github.com/acme/app/blob/release/2/openfabriq/automations/implement-ready-issues/automation.md) · run `k3x9`</sub>",
	);
	// In an area, the link goes to the folder the file is in.
	expect(
		credit({
			repository: "acme/app",
			defaultBranch: "main",
			automation: "nightly-audit",
			area: "security",
			agent: "auditor",
			runId: "a1",
		}),
	).toContain(
		"automation [nightly-audit](https://github.com/acme/app/blob/main/openfabriq/security/automations/nightly-audit/automation.md)",
	);
	// The engine's own automation has no file, and the engine's hand-off has no agent.
	expect(
		credit({
			repository: "acme/app",
			defaultBranch: "main",
			automation: "wiki",
			builtIn: true,
			runId: "w1",
		}),
	).toBe(
		"---\n<sub>🤖 Written by [openfabriq](https://github.com/openfabriq/openfabriq) · automation `wiki` · run `w1`</sub>",
	);
});

it("drops a credit line an agent copied, so the engine's own is the only one", () => {
	const copied =
		"Reproduced.\n\n---\n<sub>🤖 Written by openfabriq · agent `ui-tester`</sub>";
	expect(withoutCredit(copied)).toBe("Reproduced.");
	expect(withoutCredit("No credit here.\n\n---\nA rule.")).toBe(
		"No credit here.\n\n---\nA rule.",
	);
});

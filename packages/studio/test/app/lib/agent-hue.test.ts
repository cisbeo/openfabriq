import { expect, it } from "vitest";
import { agentHues, spreadHue } from "../../../app/src/lib/agent-hue.js";

it("spreads the agents' hues apart, clear of the accent's blue and the amber of needs-you", () => {
	for (const count of [1, 2, 5, 8, 12]) {
		const hues = Array.from({ length: count }, (_, i) => spreadHue(i, count));
		expect(new Set(hues).size).toBe(count);
		for (const h of hues) {
			expect(h >= 0 && h < 360).toBe(true);
			expect(h > 237 && h < 290).toBe(false);
			expect(h > 53 && h < 100).toBe(false);
		}
	}
	const eight = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => spreadHue(i, 8));
	const sorted = [...eight].sort((a, b) => a - b);
	const gaps = sorted.slice(1).map((h, i) => h - (sorted[i] ?? 0));
	expect(Math.min(...gaps)).toBeGreaterThanOrEqual(30);
});

it("gives each known agent its own hue, by name order, and any other one a hue from its name", () => {
	const agentHue = agentHues(["reviewer", "documenter", "reviewer"]);
	expect(agentHue("documenter")).toBe(`oklch(0.64 0.13 ${spreadHue(0, 2)})`);
	expect(agentHue("reviewer")).toBe(`oklch(0.64 0.13 ${spreadHue(1, 2)})`);
	expect(agentHue("stranger")).toBe(agentHue("stranger"));
	expect(agentHue("stranger")).not.toBe(agentHue("documenter"));
	expect(agentHues([])("stranger")).toBe(agentHue("stranger"));
});

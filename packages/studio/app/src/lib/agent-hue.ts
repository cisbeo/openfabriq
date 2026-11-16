/**
 * A stable hue per agent, so the eye follows one agent across the board, the runs and a
 * run's trail. Same lightness and chroma for all: no agent shouts louder than another.
 */

/**
 * The wheel the agents share: around it, minus the accent's blue (so a mark never reads as a
 * link or as live) and the amber of "needs you" (where hues also turn muddy at this lightness).
 */
const ARCS: [from: number, length: number][] = [
	[290, 123], // purple, pink, red, orange
	[100, 137], // lime, green, teal, cyan
];
const WHEEL = ARCS.reduce((sum, [, length]) => sum + length, 0);

/** The hue of the agent at `index` among `count`, spread evenly along the agents' wheel. */
export function spreadHue(index: number, count: number): number {
	let at = ((index + 0.5) * WHEEL) / count;
	for (const [from, length] of ARCS) {
		if (at < length) return Math.round(from + at) % 360;
		at -= length;
	}
	return ARCS[0]?.[0] ?? 0;
}

/** An agent's color, by its name. */
export type AgentHue = (name: string) => string;

/**
 * The colors of the agents in `names` (from the board): each its own share of the wheel, by name
 * order, so no two of them look alike. An agent not in `names` (yet) gets a hue from its name.
 */
export function agentHues(names: string[]): AgentHue {
	const known = [...new Set(names)].sort();
	return (name) => {
		const index = known.indexOf(name);
		if (index >= 0) return `oklch(0.64 0.13 ${spreadHue(index, known.length)})`;
		let h = 0;
		for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
		return `oklch(0.64 0.13 ${h})`;
	};
}

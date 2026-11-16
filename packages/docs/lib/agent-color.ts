// The studio's agent colors (packages/studio/app/src/lib/agent-hue.ts): the same lightness and
// chroma for every agent, so none shouts louder than another; only the hue tells them apart.

export const agentColor = (hue: number) => `oklch(0.64 0.13 ${hue})`;

/** A stable hue from an agent's name, as the studio gives an agent it does not list. */
export function hueOf(name: string) {
	let h = 0;
	for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
	return h;
}

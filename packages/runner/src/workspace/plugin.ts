import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Agent } from "@openfabriq/core";

// The engine's own skills: beside dist/ in the npm package, or packages/runner/skills here.
const ENGINE_SKILLS =
	[
		fileURLToPath(new URL("../skills", import.meta.url)),
		fileURLToPath(new URL("../../skills", import.meta.url)),
	].find((dir) => existsSync(join(dir, "wiki"))) ?? "";

/**
 * A local Claude Code plugin in `dir` with the shared skills, those of the agent's area and the
 * agent's own skills, or, for an agent the engine provides, the engine's skills; undefined when
 * there is no skill at all.
 */
export function buildPlugin(
	factoryDir: string,
	agent: Pick<Agent, "name" | "area" | "builtIn">,
	dir: string,
): string | undefined {
	const area = agent.area ? join(factoryDir, agent.area) : factoryDir;
	const sources = [
		join(factoryDir, "skills"),
		...(agent.area ? [join(area, "skills")] : []),
		agent.builtIn ? ENGINE_SKILLS : join(area, "agents", agent.name, "skills"),
	].filter((s) => existsSync(s));
	if (sources.length === 0) return undefined;
	mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
	writeFileSync(
		join(dir, ".claude-plugin/plugin.json"),
		`${JSON.stringify({ name: "openfabriq" })}\n`,
	);
	for (const source of sources)
		cpSync(source, join(dir, "skills"), { recursive: true });
	return dir;
}

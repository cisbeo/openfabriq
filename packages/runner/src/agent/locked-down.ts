import type { Options, Settings } from "@anthropic-ai/claude-agent-sdk";

/**
 * The Agent SDK options of every Claude Code the engine starts, an agent's or the chat's, with the
 * security invariants set here only: the project's settings and never the machine's, never the
 * repository's hooks, the engine's own API key helper, no prompt for a permission (a tool not
 * allowed is refused), and no MCP server but those given. The caller's parts keep their order.
 */
/** The options set here only: no caller's part may carry them, so none can loosen them. */
type Locked =
	| "settingSources"
	| "settings"
	| "permissionMode"
	| "strictMcpConfig";
type Part = Omit<Options, Locked>;

export function lockedDownOptions(
	parts: {
		/** Where Claude Code runs: its executable, cwd, directories and env. */
		where: Part;
		/** The repository's settings, as the engine allows them. */
		settings: Omit<Settings, "disableAllHooks" | "apiKeyHelper">;
		/** Hooks, prompt, model, tools and servers. */
		session: Part;
		/** The budget, and how the session is kept. */
		limits: Part;
		/** The abort controller, and the session to resume. */
		control: Part;
	},
	auth: { apiKeyHelper?: string },
): Options {
	return {
		...parts.where,
		settingSources: ["project"],
		settings: {
			// The repository's settings load, never its hooks: they would run commands unseen by plan.
			disableAllHooks: true,
			...parts.settings,
			...(auth.apiKeyHelper ? { apiKeyHelper: auth.apiKeyHelper } : {}),
		},
		...parts.session,
		permissionMode: "dontAsk",
		...parts.limits,
		// Only the engine's servers and the factory's: no claude.ai connectors, no user or project MCP servers.
		strictMcpConfig: true,
		...parts.control,
	};
}

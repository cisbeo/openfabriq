// No Node import here: the app imports this file too, to name the tool calls of the chat, and the
// engine to show a delegated run's steps in Linear.

/** The tools an agent proposes its outputs with: the engine applies them after the run, if `can` allows. */
export const OUTPUT_TOOL_PREFIX = "mcp__openfabriq__";

export interface ToolSummary {
	/** "Read", "Run command", "Open pull request"… */
	title: string;
	/** The file, command, pattern or title the call is about. */
	detail?: string;
	/** A proposed output (`mcp__openfabriq__*`), not a tool the agent used to work. */
	output: boolean;
}

const OUTPUT_TITLES: Record<string, [string, string]> = {
	add_comment: ["Comment", "body"],
	add_labels: ["Add labels", "labels"],
	remove_labels: ["Remove labels", "labels"],
	create_pull_request: ["Open pull request", "title"],
	push_to_pull_request: ["Push to pull request", "summary"],
	request_changes: ["Request changes", "body"],
	create_issue: ["Open issue", "title"],
	close_issue: ["Close issue", ""],
	close_pr: ["Close pull request", ""],
	merge_pull_request: ["Merge pull request", ""],
};

/** The engine's command tool shares the prefix, but it runs a named command: it writes nothing on GitHub. */
const COMMAND_TOOL = `${OUTPUT_TOOL_PREFIX}run_command`;

/** A tool an agent proposes an output with, not the command tool beside them. */
export const isOutputTool = (name: string) =>
	name.startsWith(OUTPUT_TOOL_PREFIX) && name !== COMMAND_TOOL;

const TOOL_TITLES: Record<string, [string, string]> = {
	Read: ["Read", "file_path"],
	Edit: ["Edit", "file_path"],
	MultiEdit: ["Edit", "file_path"],
	Write: ["Write", "file_path"],
	NotebookEdit: ["Edit notebook", "notebook_path"],
	Bash: ["Run", "description"],
	Grep: ["Search", "pattern"],
	Glob: ["Find files", "pattern"],
	Skill: ["Load skill", "skill"],
	WebFetch: ["Fetch", "url"],
	WebSearch: ["Search the web", "query"],
	Task: ["Delegate", "description"],
	Agent: ["Delegate", "description"],
	TodoWrite: ["Update plan", ""],
	// The chat's own tools, named without their server prefix.
	factory_overview: ["Read the factory", ""],
	read_run: ["Read run", "id"],
};

/** A run's files live in a worktree: show the path inside the repository, not the machine's. */
const shortPath = (value: string) =>
	value.replace(/^.*\/(worktrees\/[^/]+|repo)\//, "");

function text(value: unknown): string | undefined {
	if (Array.isArray(value)) return value.map(String).join(", ");
	if (typeof value !== "string" || !value.trim()) return undefined;
	// "## Review of PR #11" → "Review of PR #11": a heading's marks are not its words.
	const line = (value.trim().split("\n")[0] ?? "").replace(/^#+\s+/, "");
	return shortPath(line.length > 140 ? `${line.slice(0, 139)}…` : line);
}

/** A readable name for one tool call, from its name and arguments. */
export function describeTool(name: string, input: unknown): ToolSummary {
	const args = (input && typeof input === "object" ? input : {}) as Record<
		string,
		unknown
	>;
	const firstString = Object.values(args).find((v) => typeof v === "string");
	const pick = (
		[title, key]: [string, string],
		output: boolean,
	): ToolSummary => {
		const detail = text(args[key]) ?? text(firstString);
		return detail ? { title, detail, output } : { title, output };
	};
	if (name === COMMAND_TOOL) return pick(["Run command", "name"], false);
	if (name.startsWith(OUTPUT_TOOL_PREFIX)) {
		const action = name.slice(OUTPUT_TOOL_PREFIX.length);
		return pick(OUTPUT_TITLES[action] ?? [action, ""], true);
	}
	// "List runs failed" reads as a failure: "List failed runs" says what the list is.
	if (name === "list_runs") {
		const status = typeof args.status === "string" ? `${args.status} ` : "";
		const agent = typeof args.agent === "string" ? args.agent : undefined;
		const title = `List ${status}runs`;
		return agent
			? { title, detail: `of ${agent}`, output: false }
			: { title, output: false };
	}
	const known = TOOL_TITLES[name];
	if (known) return pick(known, false);
	// mcp__server__tool → "tool", with its first text argument.
	return pick(
		[name.startsWith("mcp__") ? (name.split("__")[2] ?? name) : name, ""],
		false,
	);
}

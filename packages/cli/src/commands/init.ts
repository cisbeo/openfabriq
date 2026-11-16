import { spawn } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { exec } from "@openfabriq/runner";
import { PATHS } from "../paths.js";
import type { CommandResult } from "../result.js";
import { canAsk } from "../ui.js";

export const WITHOUT_CLAUDE = `openfabriq init sets up your factory in a conversation with Claude Code. It needs an interactive terminal and the claude command on your PATH (https://claude.com/claude-code).
Without them, copy an example instead: openfabriq init --example 01-quickstart (the others are in the examples/ folder of openfabriq).`;

type InitChoice =
	| { mode: "example"; example: string }
	| { mode: "claude"; args: string[] }
	| { mode: "unavailable"; output: string };

const quote = (path: string) => (/\s/.test(path) ? `"${path}"` : path);

/** Whether the `openfabriq` command on the PATH is this CLI, as after a global install. */
export function onPath(cli: string, path = process.env.PATH ?? ""): boolean {
	const real = (file: string) => {
		try {
			return realpathSync(file);
		} catch {
			return undefined;
		}
	};
	const target = real(cli);
	return path
		.split(delimiter)
		.some((dir) => dir && target && real(join(dir, "openfabriq")) === target);
}

/** With --example, copy it; otherwise open Claude Code with the openfabriq plugin on the setup skill. */
export function chooseInit(options: {
	example?: string | undefined;
	interactive: boolean;
	cli: string;
	plugin: string;
	examples: string;
	/** `openfabriq` on the PATH is this CLI: the skill tells the person that command, not `node <path>`. */
	onPath?: boolean;
	/** Run through npx, which puts openfabriq on the PATH only while it runs: the skill tells npx. */
	npx?: boolean;
}): InitChoice {
	const command = options.npx
		? "npx openfabriq@latest"
		: options.onPath
			? "openfabriq"
			: `node ${quote(options.cli)}`;
	if (options.example) return { mode: "example", example: options.example };
	if (!options.interactive)
		return { mode: "unavailable", output: WITHOUT_CLAUDE };
	return {
		mode: "claude",
		args: [
			"--plugin-dir",
			options.plugin,
			`/openfabriq:setup The openfabriq command is \`${command}\`. The examples are in ${options.examples}.`,
		],
	};
}

interface Detected {
	repository?: string;
	login?: string;
}

/** Copies an example into ./openfabriq, with the repository and maintainer filled in when known. */
export function init(
	dir: string,
	example: string,
	detected: Detected,
	examples = PATHS.examples,
): CommandResult {
	const names = readdirSync(examples)
		.filter((n) => existsSync(join(examples, n, "openfabriq")))
		.sort();
	if (!names.includes(example))
		return {
			code: 1,
			output: `Unknown example "${example}". Use one of: ${names.join(", ")}`,
		};
	const target = join(dir, "openfabriq");
	if (existsSync(target))
		return { code: 1, output: `${target} already exists. Nothing was copied.` };
	cpSync(join(examples, example, "openfabriq"), target, { recursive: true });
	const factoryFile = join(target, "factory.yaml");
	let factory = readFileSync(factoryFile, "utf8");
	// The value only: the example's comment on the line stays.
	if (detected.repository)
		factory = factory.replace(
			/^repository: [^\s#]+/m,
			`repository: ${detected.repository}`,
		);
	if (detected.login)
		factory = factory.replace(
			/^maintainers: \[[^\]]*\]/m,
			`maintainers: [${detected.login}]`,
		);
	writeFileSync(factoryFile, factory);
	const todo = [
		...(detected.repository
			? []
			: ["set repository in openfabriq/factory.yaml"]),
		...(detected.login ? [] : ["set maintainers in openfabriq/factory.yaml"]),
	];
	return {
		code: 0,
		output: [
			`Created openfabriq/ from ${example}.`,
			...todo.map((t) => `! ${t}`),
			"Next: commit openfabriq/, then openfabriq start here: it shows the plan and applies it once you type yes.",
		].join("\n"),
	};
}

/** Hands the terminal to Claude Code until the user leaves the conversation. */
function openClaudeCode(args: string[], cwd: string): Promise<CommandResult> {
	mkdirSync(cwd, { recursive: true });
	return new Promise((resolve) => {
		spawn("claude", args, { cwd, stdio: "inherit" })
			.on("error", (error: NodeJS.ErrnoException) =>
				resolve({
					code: 1,
					output: error.code === "ENOENT" ? WITHOUT_CLAUDE : error.message,
				}),
			)
			.on("exit", (code) => resolve({ code: code ?? 1, output: "" }));
	});
}

/** openfabriq init: opens Claude Code, or copies an example with what gh knows filled in. */
export async function initCommand(
	dir: string,
	example: string | undefined,
): Promise<CommandResult> {
	const choice = chooseInit({
		example,
		interactive: canAsk,
		...PATHS,
		onPath: onPath(PATHS.cli),
		npx: process.env.npm_command === "exec",
	});
	if (choice.mode === "unavailable") return { code: 1, output: choice.output };
	if (choice.mode === "claude") return openClaudeCode(choice.args, dir);
	const detect = (args: string[]) =>
		exec("gh", args).then(
			(out) => out.trim() || undefined,
			() => undefined,
		);
	const [repository, login] = await Promise.all([
		detect([
			"repo",
			"view",
			"--json",
			"nameWithOwner",
			"--jq",
			".nameWithOwner",
		]),
		detect(["api", "user", "--jq", ".login"]),
	]);
	return init(dir, choice.example, {
		...(repository ? { repository } : {}),
		...(login ? { login } : {}),
	});
}

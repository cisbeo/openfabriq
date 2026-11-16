import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appCredentials, errorText, exec, home } from "@openfabriq/runner";
import type { CommandResult } from "../result.js";

// What openfabriq needs on this machine, checked on first use until it is all there.

export const GH_LOGIN =
	"The GitHub CLI is not logged in to github.com: run gh auth login";
export const GIT_NO_NAME =
	'git has no name for your commits: run git config --global user.name "Your Name"';
export const GIT_NO_EMAIL =
	"git has no email for your commits: run git config --global user.email you@example.com";

/**
 * Each missing piece, with the exact command that fixes it. As a GitHub App, gh needs no login and
 * git no user: the engine gives gh each repository's token, and commits as the app.
 */
export async function missingPrerequisites(
	run = exec,
	app = appCredentials() !== undefined,
): Promise<string[]> {
	const outcome = (command: string, args: string[]) =>
		run(command, args).then(
			() => "ok" as const,
			(error: unknown) =>
				errorText(error).includes("ENOENT")
					? ("not installed" as const)
					: ("failed" as const),
		);
	// Each exits 1 when logged out or unset.
	const [claude, gh, name, email] = await Promise.all([
		outcome("claude", ["auth", "status"]),
		outcome(
			"gh",
			app ? ["--version"] : ["auth", "status", "--hostname", "github.com"],
		),
		outcome("git", ["config", "--get", "user.name"]),
		outcome("git", ["config", "--get", "user.email"]),
	]);
	return [
		claude === "not installed" &&
			"Claude Code is not installed: see https://claude.com/claude-code, then run claude auth login",
		claude === "failed" &&
			"Claude Code is not logged in: run claude auth login (or set ANTHROPIC_API_KEY on a server)",
		gh === "not installed" &&
			"The GitHub CLI is not installed: brew install gh (or see https://cli.github.com), then run gh auth login",
		gh === "failed" && GH_LOGIN,
		name === "not installed" && "git is not installed: see https://git-scm.com",
		name === "failed" && !app && GIT_NO_NAME,
		email === "failed" && !app && GIT_NO_EMAIL,
	].filter((line) => typeof line === "string");
}

interface PrerequisiteDeps {
	run?: typeof exec;
	interactive: boolean;
	confirm: (question: string) => Promise<boolean>;
	ghLogin: () => Promise<void>;
}

/** On first use, says what is missing and offers gh auth login; once all is there, it is not checked again. */
export async function checkPrerequisites(
	deps: PrerequisiteDeps,
): Promise<CommandResult | undefined> {
	const checked = join(home(), "prerequisites-checked");
	if (existsSync(checked)) return undefined;
	let missing = await missingPrerequisites(deps.run);
	if (
		missing.includes(GH_LOGIN) &&
		deps.interactive &&
		(await deps.confirm(`${GH_LOGIN}. Run it now?`))
	) {
		await deps.ghLogin();
		missing = await missingPrerequisites(deps.run);
	}
	if (missing.length > 0)
		return {
			code: 1,
			output: [
				"openfabriq needs a few things on this machine first:",
				...missing.map((line) => `- ${line}`),
				"Then run the same command again.",
			].join("\n"),
		};
	mkdirSync(home(), { recursive: true });
	writeFileSync(checked, `${new Date().toISOString()}\n`);
	return undefined;
}

/** gh's own login, in this terminal. */
export const ghLogin = () =>
	new Promise<void>((resolve) => {
		spawn("gh", ["auth", "login"], { stdio: "inherit" })
			.on("exit", () => resolve())
			.on("error", () => resolve());
	});

import { execFile } from "node:child_process";

export interface ExecOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	input?: string;
	/** Stopped after this long: a command waiting on a frozen network never holds its caller. */
	timeoutMs?: number;
}

/** What is known of a command that failed without a word: its exit code or the signal that stopped it. */
function silentFailure(
	error: Error & { code?: unknown; signal?: unknown },
): string {
	if (typeof error.signal === "string") return `stopped by ${error.signal}`;
	if (typeof error.code === "number")
		return `exited with code ${error.code}, without a message (often a passing network or GitHub error; the next round tries again)`;
	return error.message;
}

/** Runs a command and returns its stdout; rejects with its stderr. */
export function exec(
	command: string,
	args: string[],
	options: ExecOptions = {},
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			command,
			args,
			{
				cwd: options.cwd,
				env: options.env,
				maxBuffer: 64 * 1024 * 1024,
				...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
			},
			(error, stdout, stderr) => {
				if (error)
					reject(
						new Error(
							`${command} ${args.join(" ")}: ${stderr.trim() || silentFailure(error)}`,
						),
					);
				else resolve(stdout);
			},
		);
		// A command that exits before reading its input breaks the pipe: the callback says why, the process lives on.
		child.stdin?.on("error", () => {});
		if (options.input !== undefined) child.stdin?.end(options.input);
	});
}

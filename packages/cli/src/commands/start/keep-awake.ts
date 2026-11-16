import { type ChildProcess, spawn } from "node:child_process";

/**
 * On macOS, no idle sleep while a run works: `caffeinate -i`, tied to this process
 * with `-w` so it never outlives the engine. Elsewhere, nothing.
 */
export function keepAwake(): ((awake: boolean) => void) | undefined {
	if (process.platform !== "darwin") return undefined;
	let child: ChildProcess | undefined;
	return (awake) => {
		if (awake && !child) {
			child = spawn("caffeinate", ["-i", "-w", String(process.pid)], {
				stdio: "ignore",
			});
			child.on("error", () => {
				child = undefined;
			});
		} else if (!awake && child) {
			child.kill();
			child = undefined;
		}
	};
}

import { expect, it } from "vitest";
import { exec } from "../src/exec.js";

it("says what a command wrote when it fails, and what is known when it said nothing", async () => {
	await expect(exec("sh", ["-c", "echo nope >&2; exit 1"])).rejects.toThrow(
		"sh -c echo nope >&2; exit 1: nope",
	);
	await expect(exec("sh", ["-c", "exit 3"])).rejects.toThrow(
		"exited with code 3, without a message",
	);
	await expect(exec("sh", ["-c", "kill -TERM $$"])).rejects.toThrow(
		"stopped by SIGTERM",
	);
	await expect(exec("no-such-command-xyz", [])).rejects.toThrow("ENOENT");
	expect(await exec("sh", ["-c", "echo ok"])).toBe("ok\n");
});

it("rejects, without crashing the process, when a command exits before reading a large input", async () => {
	await expect(
		exec("sh", ["-c", "exit 4"], { input: "x".repeat(4 * 1024 * 1024) }),
	).rejects.toThrow("exited with code 4");
});

it("stops a command that runs past its time", async () => {
	await expect(exec("sleep", ["5"], { timeoutMs: 100 })).rejects.toThrow(
		"stopped by SIGTERM",
	);
});

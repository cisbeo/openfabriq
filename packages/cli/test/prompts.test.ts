import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";

const stdin = Object.getOwnPropertyDescriptor(process, "stdin");
afterEach(() => {
	if (stdin) Object.defineProperty(process, "stdin", stdin);
	vi.restoreAllMocks();
	vi.resetModules();
});

it("keeps the answers piped ahead of their questions, such as a token sent with the URL", async () => {
	const input = new PassThrough();
	Object.defineProperty(process, "stdin", {
		value: input,
		configurable: true,
	});
	const written: string[] = [];
	vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
		written.push(String(chunk));
		return true;
	});
	const { terminalAsk } = await import("../src/prompts.js");
	input.write("https://relay.example\n\u001b[200~tok\u001b[201~\n");
	expect(await terminalAsk("URL: ")).toBe("https://relay.example");
	expect(await terminalAsk("Token: ", { secret: true })).toBe("tok");
	const third = terminalAsk("Name: ");
	input.write("later\n");
	expect(await third).toBe("later");
	expect(written.join("")).toBe("URL: \nToken: \nName: \n");
});

it("answers nothing, and goes on, when the pipe ends before the questions do", async () => {
	const input = new PassThrough();
	Object.defineProperty(process, "stdin", {
		value: input,
		configurable: true,
	});
	vi.spyOn(process.stdout, "write").mockImplementation(() => true);
	const { terminalAsk } = await import("../src/prompts.js");
	input.write("only\n");
	expect(await terminalAsk("First: ")).toBe("only");
	// Asked while the pipe is still open, then the pipe ends.
	const second = terminalAsk("Second: ");
	input.end();
	expect(await second).toBe("");
	// Asked once the pipe has ended.
	expect(await terminalAsk("Third: ")).toBe("");
});

it("drops the bracketed-paste marks a terminal wraps around a pasted secret", async () => {
	const { withoutPasteMarks } = await import("../src/prompts.js");
	expect(withoutPasteMarks("\u001b[200~abc123\u001b[201~")).toBe("abc123");
	expect(withoutPasteMarks("plain")).toBe("plain");
});

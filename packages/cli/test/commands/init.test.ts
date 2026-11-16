import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
	chooseInit,
	init,
	onPath,
	WITHOUT_CLAUDE,
} from "../../src/commands/init.js";
import { validateCommand } from "../../src/commands/validate.js";

const EXAMPLES = join(import.meta.dirname, "../../../../examples");
const PATHS = {
	cli: "/opt/openfabriq/packages/cli/dist/index.js",
	plugin: "/opt/openfabriq/packages/cli/plugin",
	examples: "/opt/openfabriq/examples",
};

it("copies an example when --example is given, even in a terminal", () => {
	expect(
		chooseInit({ example: "02-sdlc", interactive: true, ...PATHS }),
	).toEqual({ mode: "example", example: "02-sdlc" });
});

it("opens Claude Code with the openfabriq plugin and the setup skill, telling it the command and the examples", () => {
	expect(chooseInit({ interactive: true, ...PATHS })).toEqual({
		mode: "claude",
		args: [
			"--plugin-dir",
			"/opt/openfabriq/packages/cli/plugin",
			"/openfabriq:setup The openfabriq command is `node /opt/openfabriq/packages/cli/dist/index.js`. The examples are in /opt/openfabriq/examples.",
		],
	});
});

it("names the openfabriq command when it is installed, so the person is never told to type node <path>", () => {
	const choice = chooseInit({ interactive: true, ...PATHS, onPath: true });
	expect(choice.mode === "claude" && choice.args[2]).toContain(
		"The openfabriq command is `openfabriq`.",
	);
	const dir = mkdtempSync(join(tmpdir(), "openfabriq-path-"));
	const cli = join(dir, "index.js");
	writeFileSync(cli, "");
	const bin = mkdtempSync(join(tmpdir(), "openfabriq-bin-"));
	expect(onPath(cli, `/nowhere:${bin}`)).toBe(false);
	symlinkSync(cli, join(bin, "openfabriq"));
	expect(onPath(cli, `/nowhere:${bin}`)).toBe(true);
	// Another openfabriq on the PATH is not this one.
	expect(onPath(join(dir, "other.js"), bin)).toBe(false);
});

it("names npx when run through it: npx puts openfabriq on the PATH only while it runs", () => {
	const choice = chooseInit({
		interactive: true,
		...PATHS,
		onPath: true,
		npx: true,
	});
	expect(choice.mode === "claude" && choice.args[2]).toContain(
		"The openfabriq command is `npx openfabriq@latest`.",
	);
});

it("quotes paths with spaces in the opening message", () => {
	const choice = chooseInit({
		interactive: true,
		...PATHS,
		cli: "/Users/a b/openfabriq/packages/cli/dist/index.js",
	});
	expect(choice.mode === "claude" && choice.args[2]).toContain(
		'`node "/Users/a b/openfabriq/packages/cli/dist/index.js"`',
	);
});

it("without a terminal, says why and suggests --example", () => {
	expect(chooseInit({ interactive: false, ...PATHS })).toEqual({
		mode: "unavailable",
		output: WITHOUT_CLAUDE,
	});
	expect(WITHOUT_CLAUDE).toContain("--example 01-quickstart");
});

it("copies an example with the detected repository and maintainer, and it validates", () => {
	const dir = mkdtempSync(join(tmpdir(), "openfabriq-init-"));
	const result = init(
		dir,
		"01-quickstart",
		{ repository: "me/app", login: "me" },
		EXAMPLES,
	);
	expect(result.code).toBe(0);
	const factory = readFileSync(join(dir, "openfabriq/factory.yaml"), "utf8");
	expect(factory).toContain("repository: me/app");
	expect(factory).toContain("maintainers: [me]");
	expect(existsSync(join(dir, "openfabriq/agents/implementer/agent.md"))).toBe(
		true,
	);
	expect(validateCommand(dir).code).toBe(0);
	expect(init(dir, "01-quickstart", {}, EXAMPLES).output).toContain(
		"already exists",
	);
});

it("keeps the example's comment on the lines it fills in", () => {
	const dir = mkdtempSync(join(tmpdir(), "openfabriq-init-"));
	init(dir, "02-sdlc", { repository: "me/app", login: "me" }, EXAMPLES);
	const factory = readFileSync(join(dir, "openfabriq/factory.yaml"), "utf8");
	expect(factory).toContain(
		"maintainers: [me] # only their actions start the factory",
	);
	expect(factory).toContain("repository: me/app\n");
});

it("lists the examples when the name is unknown, and says what is left to fill in", () => {
	const dir = mkdtempSync(join(tmpdir(), "openfabriq-init-"));
	expect(init(dir, "03-nope", {}, EXAMPLES).output).toBe(
		`Unknown example "03-nope". Use one of: ${readdirSync(EXAMPLES).sort().join(", ")}`,
	);
	expect(init(dir, "02-sdlc", {}, EXAMPLES).output).toContain(
		"! set repository",
	);
});

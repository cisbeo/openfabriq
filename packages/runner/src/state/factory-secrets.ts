import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../files.js";
import { home } from "./projects.js";

// The values of a factory's secrets, on the engine's machine only: one .env file per
// project, all of them in one folder that the sandboxes of commands and agents close whole.

/** The folder of every project's secret values. */
export const factorySecretsDir = () => join(home(), "secrets");

/**
 * The engine's Anthropic API key, written from its environment for Claude Code's helper.
 * In the folder every sandbox denies, even for a file written after it started; the underscore keeps
 * it apart from the owners' folders, as GitHub names have none.
 */
export const claudeKeyPath = () =>
	join(factorySecretsDir(), "anthropic_api_key");

/** The file of one project's secret values: ~/.openfabriq/secrets/<owner>/<repo>.env. */
export function factorySecretsPath(repository: string): string {
	const [owner, repo, ...rest] = repository.split("/");
	// The repository comes from an applied factory; a path is never built from anything else.
	if (
		!owner ||
		!repo ||
		rest.length ||
		[owner, repo].some((p) => /^\.+$/.test(p))
	)
		throw new Error(`"${repository}" is not owner/repo`);
	return join(factorySecretsDir(), owner, `${repo}.env`);
}

/** The folder, created closed to other users: on Linux, a sandbox denies only a folder that exists. */
export function ensureFactorySecretsDir(): string {
	const dir = factorySecretsDir();
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	chmodSync(dir, 0o700);
	return dir;
}

const readText = (path: string) =>
	existsSync(path) ? readFileSync(path, "utf8").replace(/^\uFEFF/, "") : "";

/** One line: a name and its value, null for a blank line or a comment, undefined when it does not read. */
function parseLine(line: string): [string, string] | null | undefined {
	const text = line.trim();
	if (!text || text.startsWith("#")) return null;
	const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
		text,
	);
	if (!match?.[1]) return undefined;
	const rest = match[2] ?? "";
	const quoted = /^(['"])(.*?)\1\s*(?:#.*)?$/.exec(rest);
	if (quoted) return [match[1], quoted[2] ?? ""];
	if (/^['"]/.test(rest)) return undefined; // a quote that never closes
	return [match[1], rest.replace(/\s+#.*$/, "")];
}

/**
 * NAME=value, one per line: a value in single or double quotes is taken as is, with no escapes; a
 * # comment may follow. `bad` holds the numbers of the lines that do not read, never their text.
 * Not node:util parseEnv: in Node 22, a quoted value with = in it adds names of its own.
 */
export function parseSecrets(text: string): {
	values: Record<string, string>;
	bad: number[];
} {
	// No prototype: a secret named constructor or toString finds nothing it was not given.
	const values: Record<string, string> = Object.create(null);
	const bad: number[] = [];
	text
		.replace(/^\uFEFF/, "")
		.split(/\r?\n/)
		.forEach((line, i) => {
			const entry = parseLine(line);
			if (entry === undefined) bad.push(i + 1);
			else if (entry) values[entry[0]] = entry[1];
		});
	return { values, bad };
}

/** The project's file as read: its values, and the lines it could not read. */
export function readFactorySecretsFile(repository: string): {
	values: Record<string, string>;
	bad: number[];
} {
	return parseSecrets(readText(factorySecretsPath(repository)));
}

/** The values written in the project's file; none when there is no file. */
export function readFactorySecrets(repository: string): Record<string, string> {
	return readFactorySecretsFile(repository).values;
}

/** Whether other users of the machine can read the project's file (it should be 0600). */
export function looseFactorySecrets(repository: string): boolean {
	const path = factorySecretsPath(repository);
	return existsSync(path) && (statSync(path).mode & 0o077) !== 0;
}

/**
 * The value of each name: the engine's environment first, as for the services' tokens,
 * then the project's file. A name with neither has no entry.
 */
export function secretValues(
	repository: string,
	names: readonly string[],
	env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
	const file = names.some((n) => !Object.hasOwn(env, n))
		? readFactorySecrets(repository)
		: {};
	const values: Record<string, string> = Object.create(null);
	for (const name of names) {
		const value = Object.hasOwn(env, name)
			? env[name]
			: Object.hasOwn(file, name)
				? file[name]
				: undefined;
		if (value !== undefined) values[name] = value;
	}
	return values;
}

/** A line the file reads back as exactly this value, or undefined when there is none. */
export function envLine(name: string, value: string): string | undefined {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || /[\r\n]/.test(value))
		return undefined;
	for (const quote of ["'", '"']) {
		if (value.includes(quote)) continue;
		const line = `${name}=${quote}${value}${quote}`;
		const read = parseSecrets(line);
		// Exactly one entry, this one: the value can never add a line or another name.
		if (
			!read.bad.length &&
			Object.keys(read.values).length === 1 &&
			read.values[name] === value
		)
			return line;
	}
	return undefined;
}

/**
 * Sets one value in the project's file, created readable by the user only. The other lines,
 * comments included, stay as they are; a file with a line it cannot read is not rewritten.
 */
export function writeFactorySecret(
	repository: string,
	name: string,
	value: string,
): void {
	const path = factorySecretsPath(repository);
	const line = envLine(name, value);
	if (!line)
		throw new Error(`the value of ${name} cannot be written to ${path}`);
	const text = readText(path);
	const { bad } = parseSecrets(text);
	if (bad.length)
		throw new Error(
			`${path} has lines that do not read (line ${bad.join(", ")}); fix them first`,
		);
	const next = withSecretLine(text, name, line);
	ensureFactorySecretsDir();
	const dir = join(path, "..");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	chmodSync(dir, 0o700);
	writeFileAtomic(path, next, 0o600);
}

/**
 * The file's text with `line` for `name`: the first line of this name takes it, later ones of the
 * same name go, and it is added at the end when there is none. Lines end with \n.
 */
export function withSecretLine(
	text: string,
	name: string,
	line: string,
): string {
	const lines = text ? text.replace(/\r?\n$/, "").split(/\r?\n/) : [];
	let done = false;
	const kept = lines.flatMap((l) => {
		if (parseLine(l)?.[0] !== name) return [l];
		if (done) return [];
		done = true;
		return [line];
	});
	if (!done) kept.push(line);
	return `${kept.join("\n")}\n`;
}

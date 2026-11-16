import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach } from "vitest";

// Shared by the tests of "openfabriq connect": a fresh home, and what each fake saw.

export const RELAY = "https://openfabriq-relay.acme.workers.dev";
export let home: string;
export let calls: string[];
export let printed: string[];

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	process.env.OPENFABRIQ_HOME = home;
	calls = [];
	printed = [];
});

export const saved = () =>
	JSON.parse(readFileSync(join(home, "secrets.json"), "utf8"));

export const withRelay = () =>
	writeFileSync(
		join(home, "secrets.json"),
		JSON.stringify({ relay: { url: RELAY, token: "rt" } }),
	);

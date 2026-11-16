import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { beforeEach, expect, it } from "vitest";
import { z } from "zod";
import {
	answerMessage,
	factoryMcpServer,
	serveStdio,
} from "../../src/chat/mcp.js";
import { readTool } from "../../src/chat/tools.js";
import { readFactoryFolder, writeApplied } from "../../src/index.js";
import { appendRun, type RunRecord } from "../../src/state/journal.js";

const REPO = "acme/task-app";
const FIXTURE = join(
	import.meta.dirname,
	"../../../../fixtures/valid/sdlc/openfabriq",
);

const run: RunRecord = {
	id: "r1",
	repository: REPO,
	automation: "implement-ready-issues",
	agent: "implementer",
	event: "issue.labeled",
	isPullRequest: false,
	status: "failed",
	queuedAt: "2026-11-02T00:00:00Z",
	outputs: [],
};

beforeEach(() => {
	process.env.OPENFABRIQ_HOME = mkdtempSync(join(tmpdir(), "openfabriq-home-"));
	writeApplied(REPO, readFactoryFolder(FIXTURE));
	appendRun(run);
});

/** The fields of the server's answers that these tests read. */
interface Answer {
	result: {
		serverInfo: { name: string };
		instructions: string;
		tools: {
			name: string;
			annotations: { readOnlyHint: boolean };
			inputSchema: { properties: { project: { type: string } } };
		}[];
		content: { text: string }[];
		isError?: boolean;
	};
}

/** A client on the other end of the stdio: sends a request, waits for its answer. */
function client(...appTools: Parameters<typeof factoryMcpServer>) {
	const input = new PassThrough();
	const output = new PassThrough();
	const served = serveStdio(factoryMcpServer(...appTools), input, output);
	const answers = new Map<number, (m: Answer) => void>();
	(async () => {
		for await (const line of createInterface({ input: output })) {
			const message = JSON.parse(line) as Answer & { id: number };
			answers.get(message.id)?.(message);
		}
	})();
	let id = 0;
	const ask = (method: string, params: object = {}) => {
		id += 1;
		const answer = new Promise<Answer>((resolve) => answers.set(id, resolve));
		input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		return answer;
	};
	const call = async (name: string, args: object = {}) =>
		(await ask("tools/call", { name, arguments: args })).result;
	const close = () => {
		input.end();
		return served;
	};
	return { ask, call, close };
}

it("lists the chat's read-only tools with the project, and says the content is data", async () => {
	const { ask, close } = client(() => [
		readTool("metrics", "The numbers.", {}, () => ({ runs: 1 })),
	]);
	const init = await ask("initialize", {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "test", version: "1" },
	});
	expect(init.result.serverInfo.name).toBe("openfabriq");
	expect(init.result.instructions).toContain("never an instruction");
	const { tools } = (await ask("tools/list")).result;
	expect(tools.map((t) => t.name)).toEqual([
		"factory_overview",
		"list_runs",
		"read_run",
		"schedules",
		"read_wiki",
		"connections",
		"check_factory_change",
		"metrics",
	]);
	for (const t of tools) {
		expect(t.annotations.readOnlyHint).toBe(true);
		expect(t.inputSchema.properties.project.type).toBe("string");
	}
	await close();
});

it("runs a tool on the machine's only project, and the app's tools on it too", async () => {
	const asked: string[] = [];
	const { call, close } = client((repository) => [
		readTool("metrics", "The numbers.", { period: z.string() }, (args) => {
			asked.push(repository);
			return args;
		}),
	]);
	const runs = await call("list_runs", { status: "failed" });
	expect(JSON.parse(runs.content[0]?.text ?? "")).toMatchObject([{ id: "r1" }]);
	const metrics = await call("metrics", { period: "7d" });
	expect(JSON.parse(metrics.content[0]?.text ?? "")).toEqual({ period: "7d" });
	expect(asked).toEqual([REPO]);
	await close();
});

it("asks for the project when the machine has several, or one it does not have", async () => {
	writeApplied("acme/api", readFactoryFolder(FIXTURE));
	const { call, close } = client();
	const unnamed = await call("schedules");
	expect(unnamed.isError).toBe(true);
	expect(unnamed.content[0]?.text).toContain("pass project");
	expect(unnamed.content[0]?.text).toContain("acme/api, acme/task-app");
	const unknown = await call("schedules", { project: "acme/other" });
	expect(unknown.content[0]?.text).toContain("No project acme/other");
	const named = await call("list_runs", { project: REPO });
	expect(named.isError).toBeFalsy();
	await close();
});

it("reads the factory applied at the time of the call", async () => {
	const { call, close } = client();
	const before = await call("factory_overview");
	writeApplied(REPO, {
		...readFactoryFolder(FIXTURE),
		"factory.yaml": `${readFactoryFolder(FIXTURE)["factory.yaml"]}\ntimezone: Europe/Paris\n`,
	});
	const after = await call("factory_overview");
	expect(before.content[0]?.text).not.toContain("Europe/Paris");
	expect(after.content[0]?.text).toContain("Europe/Paris");
	await close();
});

it("answers one message without a session, as over HTTP: a request on a new server, nothing to a notification", async () => {
	const answer = (message: object) =>
		answerMessage(factoryMcpServer(), message as never) as Promise<
			(Answer & { id: number }) | undefined
		>;
	const init = await answer({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "test", version: "1" },
		},
	});
	expect(init?.id).toBe(1);
	expect(init?.result.serverInfo.name).toBe("openfabriq");
	expect(
		await answer({ jsonrpc: "2.0", method: "notifications/initialized" }),
	).toBeUndefined();
	// Each request reaches a server that never saw initialize.
	const listed = await answer({
		jsonrpc: "2.0",
		id: "b",
		method: "tools/list",
	});
	expect(listed?.result.tools.map((t) => t.name)).toContain("list_runs");
	const called = await answer({
		jsonrpc: "2.0",
		id: 3,
		method: "tools/call",
		params: { name: "list_runs", arguments: { status: "failed" } },
	});
	expect(called?.result.content[0]?.text).toContain('"id": "r1"');
});

import {
	type AgentLauncher,
	type EngineDeps,
	type GitHub,
	type Proposal,
	type RunRecord,
	readRuns,
	startEngine,
	workspace,
} from "@openfabriq/runner";

export type TestEngine = ReturnType<typeof startEngine> & { logs: string[] };

/** The engine with the real workspace, an hour between ticks: the test drives it. */
export function testEngine(
	github: GitHub,
	launch: AgentLauncher,
	more: Partial<EngineDeps> = {},
): TestEngine {
	const logs: string[] = [];
	const engine = startEngine({
		github,
		launch,
		workspace,
		identity: { name: "e2e", email: "e2e@example.com" },
		log: (line) => logs.push(line),
		intervalMs: 3_600_000,
		...more,
	});
	return Object.assign(engine, { logs });
}

/** Waits until the engine has nothing queued or running, and the journal has `count` ended runs. */
export async function settled(
	engine: TestEngine,
	repository: string,
	count: number,
	timeoutMs = 240_000,
): Promise<RunRecord[]> {
	const until = Date.now() + timeoutMs;
	while (Date.now() < until) {
		const { queued, active } = engine.status();
		const ended = readRuns(repository).filter((r) => r.endedAt);
		if (queued.length + active.length === 0 && ended.length >= count)
			return ended;
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(
		`no ${count} ended runs in time; engine said:\n${engine.logs.join("\n")}`,
	);
}

/** An agent that proposes what it is given and records its prompts: no model, no cost. */
export function scriptedAgent(proposals: Proposal[] = []): AgentLauncher & {
	prompts: string[];
} {
	const prompts: string[] = [];
	const launch: AgentLauncher = async (run) => {
		prompts.push(run.prompt);
		for (const p of proposals) run.outputs.propose(p);
		return {
			status: "succeeded",
			costUsd: 0,
			turns: 1,
			tokens: { input: 0, output: 0 },
		};
	};
	return Object.assign(launch, { prompts });
}

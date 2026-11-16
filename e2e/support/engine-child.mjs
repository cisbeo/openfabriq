// The engine in its own process, as `openfabriq start` runs it, with a scripted agent.
// SLOW=1: the agent never ends, so the process can be killed in the middle of a run.
import { startEngine, workspace } from "../../packages/runner/dist/index.js";

const no = async () => {
	throw new Error("not used");
};
const github = new Proxy(
	{
		currentUser: async () => "e2e-bot",
		defaultBranch: async () => "main",
		labels: async () => [],
		issuesUpdatedSince: async () => [],
		openPulls: async () => [],
		branchHead: async () => "head",
		reviews: async () => [],
	},
	{ get: (target, name) => target[name] ?? no },
);
const engine = startEngine({
	github,
	workspace,
	identity: { name: "e2e", email: "e2e@example.com" },
	intervalMs: 3_600_000,
	log: (line) => console.log(line),
	launch: async () => {
		if (process.env.SLOW) await new Promise(() => {});
		return {
			status: "succeeded",
			costUsd: 0,
			turns: 1,
			tokens: { input: 0, output: 0 },
		};
	},
});
engine.start();

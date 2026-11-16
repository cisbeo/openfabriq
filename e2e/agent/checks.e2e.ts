import { claudeAgent, readRuns, requestRun } from "@openfabriq/runner";
import { beforeEach, expect, it } from "vitest";
import { settled, testEngine } from "../support/engine.js";
import { fakeGitHub } from "../support/github.js";
import { applyProject, freshHome, originBranches } from "../support/home.js";

// The harness, with a real agent (haiku), the real workspace and a local origin: the
// engine runs the checks before code leaves the machine, and pushes only code that passes them.

const REPO = "acme/app";
let origin: string;

const factory = (test: string) => ({
	"factory.yaml": `name: E2E
repository: ${REPO}
maintainers: [alice]
model: haiku
commands:
  test: ${test}
checks: [test]
`,
	"agents/writer/agent.md":
		"---\ndescription: Writes a file\ntools: [read, edit, shell]\n---\nYou make the change asked, commit it with git, and open a pull request.\n",
	"automations/write-note/automation.md": `---
when:
  schedule: { cron: "0 3 * * *" }
agent: writer
can: [create_pull_request]
---
Create the file NOTE.md containing the single line "hello from the factory". Commit it with git (message "Add NOTE.md"). Then open a pull request titled "Add NOTE.md". If a check fails, do not change the check: say so and stop.
`,
});

const run = () => {
	requestRun(REPO, {
		id: `req-${Date.now()}`,
		automation: "write-note",
		isPullRequest: false,
		by: "e2e",
		at: new Date().toISOString(),
	});
	const { github, writes } = fakeGitHub();
	const engine = testEngine(github, claudeAgent);
	engine.start();
	return settled(engine, REPO, 1).then((runs) => {
		engine.stop();
		return { run: runs[0], writes };
	});
};

beforeEach(() => {
	freshHome();
});

it("pushes the agent's commit and opens the pull request when the checks pass", async () => {
	({ origin } = applyProject(REPO, factory("test -f NOTE.md")));
	const { run: done, writes } = await run();
	expect(done?.status).toBe("succeeded");
	expect(writes).toEqual([
		expect.stringMatching(
			/^pull request openfabriq\/write-note-.+: Add NOTE\.md/,
		),
	]);
	// The branch is really on the origin.
	expect(
		originBranches(origin).some((b) => b.startsWith("openfabriq/write-note-")),
	).toBe(true);
});

it("refuses the pull request when a check still fails, and hands the run to a human", async () => {
	({ origin } = applyProject(
		REPO,
		factory("echo 'the tests fail on purpose' && exit 1"),
	));
	const { run: done, writes } = await run();
	expect(done?.status).toBe("failed");
	expect(done?.reason).toContain("test");
	expect(writes).toEqual([]);
	expect(originBranches(origin)).toEqual(["main"]);
	expect(readRuns(REPO)).toHaveLength(1);
});

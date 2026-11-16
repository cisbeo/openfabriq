import type { Factory } from "@openfabriq/core";
import { expect, it, vi } from "vitest";
import type { QueuedRun } from "../../src/engine/queue.js";
import type { GitHub } from "../../src/github/github.js";
import { readLinked } from "../../src/run/subject.js";

it("reads what a subject points at on GitHub only for a run that comes from GitHub", async () => {
	const subject = vi.fn();
	const github = { subject } as unknown as GitHub;
	const factory = { repository: "acme/app" } as Factory;
	const data = { pull_request: { closingIssuesReferences: [{ number: 2 }] } };
	const fromLinear = {
		event: {
			event: "pull_request.opened",
			isPullRequest: true,
			source: { kind: "linear" },
		},
	} as unknown as QueuedRun;
	expect(await readLinked(fromLinear, factory, { github }, data)).toBe(data);
	expect(subject).not.toHaveBeenCalled();
});

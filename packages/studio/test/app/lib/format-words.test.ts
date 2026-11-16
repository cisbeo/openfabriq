import { ACTIONS, EVENTS } from "@openfabriq/core";
import { expect, it } from "vitest";
import { ACTION_SHORT, EVENT_SHORT } from "../../../app/src/lib/format.js";

it("has a short name for every event and every output of the format", () => {
	expect(EVENTS.filter((e) => !EVENT_SHORT[e])).toEqual([]);
	expect(ACTIONS.filter((a) => !ACTION_SHORT[a])).toEqual([]);
});

it("previews a Markdown file as plain words", async () => {
	const { markdownPreview } = await import("../../../app/src/lib/format.js");
	expect(
		markdownPreview(
			"# Implementation\n\nYou are the **implementation** agent.\n\n## Input\n- The `issue`, see [docs](http://x).",
		),
	).toEqual({
		title: "Implementation",
		excerpt: "You are the implementation agent. The issue, see docs.",
	});
	expect(markdownPreview("Just a task.")).toEqual({ excerpt: "Just a task." });
});

it("names a run's output after where it is written", async () => {
	const { fromGitHub, outputWords, outputShort, sourceOutput } = await import(
		"../../../app/src/lib/format.js"
	);
	expect(outputWords("add_comment", "slack")).toBe("Slack reply");
	expect(outputWords("add_comment", "linear")).toBe("Linear comment");
	expect(outputWords("add_comment", "sentry")).toBe("Sentry note");
	expect(outputWords("add_labels", "linear")).toBe("Linear labels");
	expect(outputShort("add_comment", "slack")).toBe("Slack reply");
	// GitHub, a webhook, or a run without a source: the action's own words.
	expect(outputWords("add_comment", "github")).toBe("Comment");
	expect(outputShort("add_comment", "webhook")).toBe("Comment");
	expect(outputWords("add_comment", undefined)).toBe("Comment");
	expect(outputShort("add_labels", "github")).toBe("Label");
	// A pull request opened from Slack is still on GitHub.
	expect(outputWords("create_pull_request", "slack")).toBe(
		"Open a pull request",
	);
	expect(sourceOutput("create_pull_request", "slack")).toBeUndefined();
	// A webhook has nowhere to answer: what it writes is on GitHub.
	expect(fromGitHub("webhook")).toBe(true);
	expect(fromGitHub(undefined)).toBe(true);
	expect(fromGitHub("sentry")).toBe(false);
});

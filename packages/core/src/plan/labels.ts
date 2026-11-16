import type { Factory } from "../factory/types.js";
import { eventSource } from "../vocabulary.js";

/** The one label the engine knows: it hands work to a human with it. */
export const HANDOFF_LABEL = "needs-human";
/**
 * The label the engine puts on an issue or a pull request while a run works on it, and takes off when it
 * ends: GitHub shows work is under way before the run's outputs come. Its events start nothing.
 */
export const WORKING_LABEL = "openfabriq:working";
/** The summary of the comment the engine writes when it hands work over. */
export const HANDOFF_SUMMARY = "handoff";
/** How the reason of a run starts when its internal review (reviewed_by) left the change to a person. */
export const REVIEW_HANDOFF = "the internal review asks for a person";
/** The risks an internal review gives a change it approves. */
export const RISKS = ["low", "medium", "high"] as const;
export type Risk = (typeof RISKS)[number];
/** The label of a risk, on a pull request an internal review approved. */
export const riskLabel = (risk: Risk) => `risk:${risk}`;
/** On a pull request an internal review approved, with its risk label: reviewed, and ready for a person to merge. */
export const READY_LABEL = "ready-to-merge";
/** The labels the engine puts after an internal review: ready-to-merge and the risks. */
export const REVIEW_LABELS = [READY_LABEL, ...RISKS.map(riskLabel)];

/**
 * Every GitHub label the factory relies on: trigger filters, label permissions, the labels of opened issues, the handoff
 * label and the working label. Labels of Linear triggers, and of automations that only start from Linear, live in Linear.
 */
export function factoryLabels(factory: Factory): string[] {
	const labels = new Set([HANDOFF_LABEL, WORKING_LABEL]);
	// An internal review labels the pull requests it approves.
	if (Object.values(factory.automations).some((a) => a.reviewedBy))
		for (const l of REVIEW_LABELS) labels.add(l);
	for (const automation of Object.values(factory.automations)) {
		const github = automation.when.filter(
			(t) => eventSource(t.event) === "github",
		);
		for (const trigger of github)
			for (const l of trigger.labels ?? []) labels.add(l);
		// The issues an automation opens are on GitHub, whatever started it.
		for (const permission of automation.can)
			if (github.length > 0 || permission.action === "create_issue")
				for (const l of [
					...(permission.labels ?? []),
					...(permission.merge?.labels ?? []),
				])
					labels.add(l);
	}
	return [...labels].sort();
}

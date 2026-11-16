import { exampleFile, highlightCode } from "@/lib/example-code";
import { CauseEffect, type CauseId } from "../cause-effect";
import { SectionHeading } from "./section-heading";

// What starts the work: one automation file per cause, from the examples.
const CAUSES: {
	id: CauseId;
	trigger: string;
	example: string;
	path: string;
}[] = [
	{
		id: "label",
		trigger: "A label",
		example: "00-at-a-glance",
		path: "automations/implement-ready-issues/automation.md",
	},
	{
		id: "sentry",
		trigger: "A production error",
		example: "00-at-a-glance",
		path: "automations/fix-production-errors/automation.md",
	},
	{
		id: "webhook",
		trigger: "A failed deploy",
		example: "00-at-a-glance",
		path: "automations/investigate-failed-deploys/automation.md",
	},
	{
		id: "slack",
		trigger: "A Slack mention",
		example: "21-slack-codebase-qa",
		path: "automations/answer-code-questions/automation.md",
	},
];

/** Each automation file beside what happens when its moment comes. */
export async function Causes() {
	const causes = await Promise.all(
		CAUSES.map(async ({ example, ...cause }) => ({
			...cause,
			file: await highlightCode(exampleFile(example, cause.path), "markdown"),
		})),
	);
	return (
		<section
			aria-labelledby="causes"
			className="border-y border-of-line bg-fd-background py-24 sm:py-32"
		>
			<div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
				<SectionHeading
					id="causes"
					lead="A label, a production error, a failed deploy, a question in Slack. Each automation is one file that ties a moment your team already lives to an agent, and to what it may write."
				>
					Every file is a cause. Every run, its effect.
				</SectionHeading>
				<div className="mt-12">
					<CauseEffect causes={causes} />
				</div>
			</div>
		</section>
	);
}

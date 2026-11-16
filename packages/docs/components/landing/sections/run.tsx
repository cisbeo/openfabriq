import { RunDemo } from "../run-demo";
import { SectionHeading } from "./section-heading";

/** A run as it happens: the agent proposes, the engine writes. */
export function Run() {
	return (
		<section aria-labelledby="run" className="py-24 sm:py-32">
			<div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
				<SectionHeading
					id="run"
					lead="Each run reads like a Claude Code session: what started it, what the agent read, ran and said. The agent has no access to GitHub. It proposes; the engine runs your checks and applies only what the automation allows."
				>
					Agents propose. The engine writes.
				</SectionHeading>
				<div className="mt-14">
					<RunDemo />
				</div>
			</div>
		</section>
	);
}

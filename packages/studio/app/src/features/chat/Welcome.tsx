import { useAui } from "@assistant-ui/react";

const SUGGESTIONS = [
	{
		title: "Why did the last run fail?",
		hint: "Reads the run and its conversation",
	},
	{
		title: "Add an agent that checks the README on every pull request",
		hint: "Proposes the files, applies nothing",
	},
	{
		title: "How much did the factory cost this week?",
		hint: "Runs and chat, per agent",
	},
	{
		title: "Which issues are waiting for a human?",
		hint: "Handed over or failed",
	},
	{
		title: "Which integrations are connected?",
		hint: "Slack, Linear, Sentry and the relay",
	},
	{
		title: "Suggest one improvement to the factory",
		hint: "A change checked by validate and plan",
	},
];

/** An empty conversation: what the chat does, and questions to start with. */
export function Welcome({ project }: { project: string }) {
	const aui = useAui();
	return (
		<div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col justify-center px-4 pt-12 pb-6 sm:px-6">
			<h1 className="text-2xl font-semibold tracking-[-0.02em]">
				Ask your factory
			</h1>
			<p className="mt-2 max-w-[62ch] text-fg-2">
				It reads the factory applied to{" "}
				<span className="font-mono text-sm text-fg">{project}</span>, its runs
				and the code, then answers. It changes nothing, on GitHub or in the
				factory.
			</p>
			<div className="mt-8 grid gap-2 sm:grid-cols-2">
				{SUGGESTIONS.map((s) => (
					<button
						key={s.title}
						type="button"
						onClick={() =>
							aui.thread.append({
								role: "user",
								content: [{ type: "text", text: s.title }],
							})
						}
						className="group rounded-xl border border-line bg-panel px-4 py-3 text-left shadow-1 transition-[border-color,box-shadow] duration-150 hover:border-line-2 hover:shadow-2"
					>
						<span className="block text-sm font-medium text-fg">{s.title}</span>
						<span className="mt-0.5 block text-xs text-fg-3">{s.hint}</span>
					</button>
				))}
			</div>
		</div>
	);
}

import type { Hunk } from "../../lib/types.js";

const ROW = {
	"+": "bg-ok-soft",
	"-": "bg-bad-soft",
	" ": "",
} as const;

const MARK = {
	"+": "text-ok",
	"-": "text-bad",
	" ": "text-fg-3",
} as const;

/** A file's recorded diff, as on GitHub: the line numbers before and after the run in two gutters, each hunk under its header. */
export function FileDiff({ path, hunks }: { path: string; hunks: Hunk[] }) {
	return (
		<div className="overflow-x-auto border-t border-line bg-sunken">
			<table
				aria-label={`Diff of ${path}`}
				className="w-full border-collapse font-mono text-xs leading-5"
			>
				<tbody>
					{hunks.map((h, i) => [
						<tr
							// biome-ignore lint/suspicious/noArrayIndexKey: hunks of a fixed diff
							key={`h${i}`}
							className="bg-accent-soft text-fg-2"
						>
							<td colSpan={3} className="px-3 py-0.5 whitespace-pre">
								{h.header}
							</td>
						</tr>,
						...h.lines.map((l, j) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: lines of a fixed diff
							<tr key={`${i}-${j}`} className={ROW[l.type]}>
								<td className="tnum w-px border-r border-line px-2 text-right text-fg-3 select-none">
									{l.old}
								</td>
								<td className="tnum w-px border-r border-line px-2 text-right text-fg-3 select-none">
									{l.new}
								</td>
								<td className="pr-4 whitespace-pre text-fg">
									<span
										className={`inline-block w-5 text-center select-none ${MARK[l.type]}`}
									>
										{l.type === " " ? "" : l.type === "-" ? "−" : "+"}
									</span>
									{l.text}
								</td>
							</tr>
						)),
					])}
				</tbody>
			</table>
		</div>
	);
}

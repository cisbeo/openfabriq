import { ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { visibleRows } from "@/lib/file-tree";

/** A factory's files as a tree: a click on a folder opens or closes it, a click on a file shows it. */
export function FileTree({
	paths,
	closed,
	selected,
	label,
	repository,
	onFolder,
	onFile,
}: {
	paths: string[];
	closed: ReadonlySet<string>;
	selected: string;
	label: string;
	repository: string;
	onFolder: (path: string) => void;
	onFile: (path: string) => void;
}) {
	return (
		<nav
			aria-label={label}
			className="max-h-56 min-h-0 overflow-auto border-b border-of-line bg-of-sunken/40 pt-5 pb-3 md:max-h-none md:border-r md:border-b-0"
		>
			<p className="truncate px-5 pb-3 font-mono text-[11.5px] text-fd-muted-foreground">
				{repository}/openfabriq/
			</p>
			<ul>
				{visibleRows(paths, closed).map((row) => {
					const current = row.path === selected;
					// Only one branch is open at a time: the way to the file shown, or to the folder just opened.
					const isOpen = row.folder && !closed.has(row.path);
					const Icon = row.folder ? (isOpen ? FolderOpen : Folder) : FileText;
					return (
						<li key={row.path}>
							<button
								type="button"
								onClick={() =>
									row.folder ? onFolder(row.path) : onFile(row.path)
								}
								aria-expanded={row.folder ? isOpen : undefined}
								aria-current={current ? "true" : undefined}
								className={`flex w-full items-center gap-1.5 py-1.5 pr-4 text-left font-mono text-[12.5px] whitespace-nowrap transition-colors duration-200 ${
									current
										? "bg-of-accent-soft text-fd-primary"
										: isOpen
											? "font-medium text-fd-foreground hover:bg-of-sunken"
											: "text-fd-muted-foreground hover:bg-of-sunken hover:text-fd-foreground"
								}`}
								style={{
									paddingLeft: `${0.875 + row.depth * 0.875}rem`,
								}}
							>
								<ChevronRight
									aria-hidden
									className={`size-3 shrink-0 opacity-60 transition-transform duration-200 ${row.folder ? "" : "invisible"} ${isOpen ? "rotate-90" : ""}`}
								/>
								<Icon
									aria-hidden
									className={`size-3.5 shrink-0 ${current || isOpen ? "text-fd-primary" : "opacity-70"}`}
								/>
								<span className="truncate">{row.name}</span>
							</button>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}

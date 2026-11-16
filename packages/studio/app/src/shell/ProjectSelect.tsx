import { Skeleton } from "../components/feedback.js";
import { useHash } from "../hooks/use-hash.js";
import { projectSwitchHref } from "../lib/route.js";

/** The project shown: choosing another goes to the same page of the menu for it, its period, view and status kept. */
export function ProjectSelect({
	projects,
	project,
	page,
	className = "",
}: {
	projects: string[] | undefined;
	project: string | undefined;
	page: string;
	className?: string;
}) {
	const { params } = useHash();
	if (!projects) return <Skeleton className={`h-8 min-w-28 ${className}`} />;
	return (
		<select
			aria-label="Project"
			className={`select ${className}`}
			value={project ?? ""}
			disabled={projects.length === 0}
			onChange={(e) => {
				window.location.hash = projectSwitchHref(page, params, e.target.value);
			}}
		>
			{projects.map((p) => (
				<option key={p} value={p}>
					{p}
				</option>
			))}
		</select>
	);
}

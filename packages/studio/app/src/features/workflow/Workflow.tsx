import { Controls, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Network } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Empty, ErrorNote, Skeleton } from "../../components/feedback.js";
import { PageHeader } from "../../components/page-layout.js";
import { useApi } from "../../hooks/use-api.js";
import { useDark } from "../../hooks/use-theme.js";
import { useWidth } from "../../hooks/use-width.js";
import { query } from "../../lib/api.js";
import { MAC } from "../../lib/platform.js";
import { workflowHref } from "../../lib/route.js";
import type { Workflow as WorkflowData } from "../../lib/types.js";
import { areasIn, areaView } from "./area-filter.js";
import { Inspector } from "./Inspector.js";
import { flowElements, frameFit, PANEL, place } from "./layout.js";
import { edgeTypes, nodeTypes } from "./nodes.js";
import { personLoops } from "./person-loops.js";

/** The workflow takes more width than other pages: a factory is wide before it is long. */
function Page({ children }: { children: ReactNode }) {
	return (
		<div className="min-h-0 flex-1 overflow-y-auto">
			<div className="mx-auto w-full max-w-[1680px] px-4 py-6 sm:px-8 sm:py-8">
				{children}
			</div>
		</div>
	);
}

/** The areas to see the graph from, when the factory has some: one link each, and All. */
function AreaFilter({
	areas,
	current,
	project,
}: {
	areas: string[];
	current: string | undefined;
	project: string;
}) {
	if (areas.length === 0) return null;
	const chosen = current && areas.includes(current) ? current : undefined;
	return (
		<nav aria-label="Areas" className="mb-4 flex flex-wrap gap-1.5">
			{[undefined, ...areas].map((c) => (
				<a
					key={c ?? ""}
					href={workflowHref({ project, area: c })}
					aria-current={c === chosen ? "page" : undefined}
					className="rounded-full border border-line-2 px-3 py-1 text-xs font-medium text-fg-2 hover:bg-hover aria-[current]:border-accent aria-[current]:bg-accent-soft aria-[current]:text-accent-text"
				>
					{c ?? "All"}
				</a>
			))}
		</nav>
	);
}

const LEGEND: { label: string; swatch: string }[] = [
	{
		label: "Work starts here",
		swatch: "rounded-full border-ok/60 bg-panel ring-2 ring-ok-soft",
	},
	{ label: "Event", swatch: "rounded-full border-line-2 bg-panel" },
	{ label: "Automation", swatch: "rounded-[4px] border-line-2 bg-panel" },
	{ label: "Reaches you", swatch: "rounded-full border-warn bg-warn-soft" },
	{
		label: "Leaves the factory",
		swatch: "rounded-full border-dashed border-line-2",
	},
];

export function Workflow({
	project: repo,
	area,
}: {
	project: string | undefined;
	/** The area the graph is seen from, from the address. */
	area?: string | undefined;
}) {
	const { data, error } = useApi<WorkflowData>(
		repo ? `/api/workflow${query({ project: repo })}` : undefined,
	);
	const dark = useDark();
	const [selected, setSelected] = useState<string>();
	const [hovered, setHovered] = useState<string>();
	const [box, width] = useWidth();
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new factory starts with nothing selected
	useEffect(() => {
		setSelected(undefined);
		setHovered(undefined);
	}, [repo]);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setSelected(undefined);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const view = useMemo(
		() => (data ? areaView(data.graph, area) : undefined),
		[data, area],
	);
	const loops = useMemo(() => (view ? personLoops(view.graph) : []), [view]);
	const placed = useMemo(
		() => (view ? place(view.graph, loops) : undefined),
		[view, loops],
	);
	// A box of another factory (after switching projects), or hidden by the area, is no focus here.
	const known = (id: string | undefined) =>
		id && view?.graph.nodes.some((n) => n.id === id) ? id : undefined;
	const current = known(selected);
	const focus = known(hovered) ?? current;
	const flow = useMemo(
		() =>
			view && placed
				? flowElements(view.graph, loops, placed, focus, view.faded)
				: undefined,
		[view, placed, focus, loops],
	);

	if (!repo)
		return (
			<Page>
				<Empty icon={<Network />} title="Choose a project">
					The workflow is drawn from one factory. Pick a project in the menu.
				</Empty>
			</Page>
		);
	if (error)
		return (
			<Page>
				<ErrorNote>{error}</ErrorNote>
			</Page>
		);
	if (!data || !view || !flow || !placed)
		return (
			<Page>
				<div className="space-y-4">
					<Skeleton className="h-7 w-56" />
					<Skeleton className="h-[480px]" />
				</div>
			</Page>
		);

	const { side, frameWidth, viewport } = frameFit(width, placed.width);

	return (
		<Page>
			<PageHeader
				title={data.name}
				{...(data.description ? { description: data.description } : {})}
			/>
			<AreaFilter areas={areasIn(data.graph)} current={area} project={repo} />
			<div
				ref={box}
				className="grid gap-8"
				style={{
					gridTemplateColumns: side
						? `minmax(0, 1fr) ${PANEL}px`
						: "minmax(0, 1fr)",
				}}
			>
				<figure className="min-w-0">
					<div
						className="flow-still relative overflow-hidden rounded-xl border border-line bg-sunken"
						style={{ height: placed.height * viewport.zoom + 24 }}
					>
						{width > 0 && (
							<ReactFlow
								key={`${Math.round(frameWidth)}-${side}`}
								nodes={flow.nodes}
								edges={flow.edges}
								nodeTypes={nodeTypes}
								edgeTypes={edgeTypes}
								colorMode={dark ? "dark" : "light"}
								defaultViewport={viewport}
								minZoom={0.3}
								maxZoom={1.6}
								nodesDraggable={false}
								nodesConnectable={false}
								elementsSelectable={false}
								// Drag moves the graph; ⌘ or Ctrl with the wheel, or a pinch, zooms. The wheel alone scrolls the page.
								panOnDrag
								zoomOnScroll={false}
								zoomActivationKeyCode={["Meta", "Control"]}
								zoomOnPinch
								zoomOnDoubleClick={false}
								preventScrolling={false}
								onNodeClick={(_, n) =>
									setSelected((s) => (s === n.id ? undefined : n.id))
								}
								onNodeMouseEnter={(_, n) => setHovered(n.id)}
								onNodeMouseLeave={() => setHovered(undefined)}
								onPaneClick={() => setSelected(undefined)}
								proOptions={{ hideAttribution: true }}
							>
								<Controls
									showInteractive={false}
									position="bottom-right"
									fitViewOptions={{ padding: 0.04, maxZoom: 1 }}
								/>
							</ReactFlow>
						)}
					</div>
					<figcaption className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-fg-2">
						{LEGEND.map((l) => (
							<span key={l.label} className="inline-flex items-center gap-2">
								<span
									aria-hidden
									className={`h-3 w-5 shrink-0 border ${l.swatch}`}
								/>
								{l.label}
							</span>
						))}
						<span className="text-fg-3 sm:ml-auto">
							Drag to move · {MAC ? "⌘" : "Ctrl"} + scroll or pinch to zoom
						</span>
					</figcaption>
				</figure>
				<aside
					aria-label="Details"
					className={
						side
							? "panel sticky top-6 h-fit p-5"
							: current
								? "panel rise fixed inset-x-4 bottom-4 z-30 max-h-[70vh] overflow-y-auto p-5 shadow-pop sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[340px]"
								: "hidden"
					}
				>
					<Inspector
						graph={data.graph}
						loops={loops}
						id={current}
						project={repo}
						onSelect={setSelected}
					/>
				</aside>
			</div>
		</Page>
	);
}

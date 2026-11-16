import { Graph, layout } from "@dagrejs/dagre";
import { HANDOFF_LABEL } from "@openfabriq/core";
import type { Edge, Node } from "@xyflow/react";
import { Bot, Factory, RotateCcw, UserRound, Wrench } from "lucide-react";
import { interrupted, isHandoffComment } from "../../../../src/runs/story.js";
import {
	duration,
	EVENT_SHORT,
	fromGitHub,
	outputHeadline,
	outputShort,
	subject,
} from "../../lib/format.js";
import { eventIcon, ICONS, type Icon } from "../../lib/icons.js";
import { runHref } from "../../lib/route.js";
import type { RunDetail, RunRecord } from "../../lib/types.js";

export type Tone = "ok" | "bad" | "warn" | "live" | "idle" | "next" | "you";

interface RunBox {
	id: string;
	tone: Tone;
	icon: Icon;
	title: string;
	detail?: string;
	href?: string;
	external?: boolean;
	/** The event that started the run: round, as on the Workflow page, with a halo. */
	event?: boolean;
}

/** "LR" on a wide screen, "TB" on a phone: where the arrows come in and go out. */
export type Box = RunBox & { dir: "LR" | "TB" } & Record<string, unknown>;

export const W = 240;
export const H = 60;

const runTone = (status: string): Tone =>
	status === "succeeded"
		? "ok"
		: status === "failed"
			? "bad"
			: status === "running"
				? "live"
				: "idle";

const outcomeTone = (status: string): Tone =>
	status === "applied" ? "ok" : status === "failed" ? "bad" : "warn";

const clean = (summary: string) => outputHeadline(summary.split("\n")[0] ?? "");

/** What the run's outputs led to: the runs they started, else the automations that should run, else you. */
export function runBoxes(
	{ run, story, reviews }: RunDetail,
	steps: number,
): { boxes: RunBox[]; links: [string, string, boolean][] } {
	const out: RunBox[] = [];
	const links: [string, string, boolean][] = [];
	const add = (box: RunBox, from?: string, next = false) => {
		out.push(box);
		if (from) links.push([from, box.id, next]);
	};
	const link = run.source?.url ?? run.url;
	const linked = (r: { id: string }) =>
		runHref(r.id, { project: run.repository });

	if (story.cause)
		add({
			id: "cause",
			tone: runTone(story.cause.status),
			icon: Bot,
			title: story.cause.agent,
			detail: `${story.cause.status} · the run before`,
			href: linked(story.cause),
		});
	add(triggerBox(run, link), story.cause ? "cause" : undefined);
	add(
		{
			id: "run",
			tone: runTone(run.status),
			icon: Bot,
			title: run.agent,
			detail: workWords(run, steps),
		},
		"trigger",
	);
	if (story.rerun)
		add(
			{
				id: "rerun",
				tone: runTone(story.rerun.status),
				icon: Bot,
				title: story.rerun.agent,
				detail: `${story.rerun.status} · ran again`,
				href: linked(story.rerun),
			},
			"run",
		);

	// reviewed_by: what the agent wrote went through the reviewer first.
	const last = reviews?.at(-1);
	if (last)
		add(
			{
				id: "review",
				tone: last.verdict === "approved" ? "ok" : "warn",
				icon: RotateCcw,
				title: last.reviewer,
				detail: `${
					last.verdict === "approved"
						? `approved${last.risk ? `, risk ${last.risk}` : ""}`
						: last.verdict === "needs_changes"
							? "still needs changes"
							: "needs a person"
				} · ${last.round} ${last.round === 1 ? "round" : "rounds"}`,
			},
			"run",
		);
	// Whatever a run that never started wrote, openfabriq wrote it.
	const writer =
		neverStarted(run, steps) && run.outputs.length > 0
			? "engine"
			: last
				? "review"
				: "run";
	if (writer === "engine")
		add(
			{
				id: "engine",
				tone: "ok",
				icon: Factory,
				title: "openfabriq",
				detail: "reported the failure",
			},
			"run",
		);

	let you = false;
	run.outputs.forEach((o, i) => {
		const id = `out${i}`;
		const engine = isHandoffComment(o);
		add(
			{
				id,
				tone: outcomeTone(o.status),
				icon: ICONS[o.action] ?? Wrench,
				title: outputShort(o.action, run.source?.kind),
				detail: `${o.status} · ${engine ? "by openfabriq" : o.removed ? o.removed.join(", ") || "nothing to remove" : clean(o.summary)}`,
				...(o.url ? { href: o.url, external: true } : {}),
			},
			writer,
		);
		const started = story.effects.filter((e) => e.output === i);
		for (const e of started)
			add(
				{
					id: `run-${e.id}`,
					tone: runTone(e.status),
					icon: Bot,
					title: e.agent,
					detail: `${e.status} · the next run`,
					href: linked(e),
				},
				id,
			);
		if (started.length === 0)
			for (const f of story.followers[i] ?? [])
				add(
					{
						id: `next-${i}-${f.automation}`,
						tone: "next",
						icon: Bot,
						title: f.agent,
						detail: `should run next · ${f.automation}`,
					},
					id,
					true,
				);
		const handoff =
			o.status === "applied" &&
			o.action === "add_labels" &&
			o.summary.split(", ").includes(HANDOFF_LABEL);
		const missed =
			story.attention?.kind === "not-applied" && o.status !== "applied";
		if (!you && (handoff || missed)) {
			you = true;
			add(youBox(o, handoff, link, fromGitHub(run.source?.kind)), id, true);
		}
	});
	// A person must act, and no output says so: the arrow leaves the run itself.
	if (story.attention && story.attention.kind !== "interrupted" && !you)
		add(
			{
				id: "you",
				tone: "you",
				icon: UserRound,
				title: "You",
				detail: "see what to do above",
			},
			"run",
			true,
		);
	return { boxes: out, links };
}

/** The event that started the run, or the person who asked for it by hand. */
function triggerBox(run: RunRecord, link: string | undefined): RunBox {
	return {
		id: "trigger",
		tone: "ok",
		event: true,
		icon: eventIcon(run.event),
		...(run.manual
			? {
					title: "Manual run",
					detail: [
						run.number === undefined ? undefined : subject(run),
						run.manual,
					]
						.filter(Boolean)
						.join(" · "),
				}
			: {
					title: EVENT_SHORT[run.event] ?? run.event,
					detail: [subject(run), run.label].filter(Boolean).join(" · "),
				}),
		...(link ? { href: link, external: true } : {}),
	};
}

/** The agent never ran: its setup failed, say. */
const neverStarted = (run: RunRecord, steps: number) =>
	run.status === "failed" && steps === 0 && !interrupted(run);

/** Where the run stands, under its agent's name. */
function workWords(run: RunRecord, steps: number): string {
	const count = steps ? ` · ${steps} ${steps === 1 ? "step" : "steps"}` : "";
	return run.status === "running"
		? `working${count}`
		: run.status === "queued"
			? "waiting for its turn"
			: interrupted(run)
				? `interrupted · ${duration(run.durationMs)}`
				: run.status === "skipped"
					? "skipped before it started"
					: neverStarted(run, steps)
						? `did not start${run.reason?.startsWith("setup ") ? " · setup failed" : ""}`
						: `${run.status}${count} · ${duration(run.durationMs)}`;
}

/** You, after the first output that hands the work to a person or was not written. */
function youBox(
	o: RunRecord["outputs"][number],
	handoff: boolean,
	link: string | undefined,
	onGitHub: boolean,
): RunBox {
	return {
		id: "you",
		tone: "you",
		icon: UserRound,
		title: "You",
		detail: handoff
			? `${HANDOFF_LABEL} · take it from here`
			: o.action === "merge_pull_request" && o.status === "refused"
				? "merge it yourself · see above"
				: `not written${onGitHub ? " on GitHub" : ""} · see above`,
		...(link ? { href: link, external: true } : {}),
	};
}

/** The boxes placed by dagre, as React Flow nodes and edges: solid links happened, dashed ones should. */
export function runFlow(detail: RunDetail, steps: number, dir: "LR" | "TB") {
	const { boxes, links } = runBoxes(detail, steps);
	const g = new Graph();
	g.setGraph({
		rankdir: dir,
		nodesep: dir === "LR" ? 14 : 20,
		ranksep: dir === "LR" ? 44 : 32,
		marginx: 4,
		marginy: 4,
	});
	g.setDefaultEdgeLabel(() => ({}));
	for (const b of boxes) g.setNode(b.id, { width: W, height: H });
	for (const [s, t] of links) g.setEdge(s, t);
	layout(g);
	const nodes: Node<Box>[] = boxes.map((b) => {
		const { x, y } = g.node(b.id);
		return {
			id: b.id,
			type: "box",
			position: { x: x - W / 2, y: y - H / 2 },
			width: W,
			height: H,
			data: { ...b, dir },
			draggable: false,
			selectable: false,
			// React Flow gives a node that is neither draggable nor selectable no pointer events: its link would never take the click.
			...(b.href ? { style: { pointerEvents: "all" as const } } : {}),
		};
	});
	const edges: Edge[] = links.map(([s, t, next]) => ({
		id: `${s}-${t}`,
		source: s,
		target: t,
		type: "smoothstep",
		// Square elbows, and stubs shorter than half the gap between boxes: links that leave one box
		// together split on one straight line, with no notch or 2 px step where they part.
		pathOptions: { borderRadius: 0, offset: 10 },
		style: {
			stroke: "var(--line-2)",
			strokeWidth: 1.25,
			...(next ? { strokeDasharray: "4 4" } : {}),
		},
	}));
	const graph = g.graph();
	return {
		nodes,
		edges,
		width: graph.width ?? 0,
		height: graph.height ?? 0,
	};
}

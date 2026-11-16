import {
	ExternalLink,
	FileText,
	Pencil,
	Settings2,
	TriangleAlert,
} from "lucide-react";
import { useId, useState } from "react";
import { Status } from "../../components/badges.js";
import { Empty, ErrorNote, PageSkeleton } from "../../components/feedback.js";
import { FileDialog } from "../../components/file-dialog.js";
import { PageHeader } from "../../components/page-layout.js";
import { Tabs } from "../../components/tabs.js";
import { useApi } from "../../hooks/use-api.js";
import { query } from "../../lib/api.js";
import { settingsHref } from "../../lib/route.js";
import type { FactorySettings } from "../../lib/types.js";
import {
	type Item,
	missing,
	type Row,
	settingsSections,
} from "./settings-view.js";

/** The command that makes something ready, to copy into a terminal. */
function Fix({ command }: { command: string }) {
	return (
		<p className="mt-1 text-xs text-fg-2">
			To set it up, run{" "}
			<code className="rounded-md bg-sunken px-1.5 py-0.5 font-mono [overflow-wrap:anywhere] text-fg ring-1 ring-line select-all">
				{command}
			</code>
		</p>
	);
}

function ItemLine({ item }: { item: Item }) {
	return (
		<li>
			<div className="flex items-baseline gap-3">
				<span className="min-w-0 flex-1">
					<span className="font-mono text-sm font-medium text-fg">
						{item.name}
					</span>
					{item.detail && (
						<span className="block font-mono text-xs [overflow-wrap:anywhere] text-fg-2 sm:ml-2.5 sm:inline">
							{item.detail}
						</span>
					)}
				</span>
				{item.ready !== undefined && (
					<Status
						status={item.ready ? "ready" : "missing"}
						className="shrink-0"
					/>
				)}
			</div>
			{item.warning && (
				<p className="mt-1 flex items-start gap-1.5 text-xs text-warn">
					<TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
					{item.warning}
				</p>
			)}
			{item.fix && <Fix command={item.fix} />}
		</li>
	);
}

function SettingRow({ row }: { row: Row }) {
	const empty = row.value === undefined && !row.items;
	return (
		// A setting the factory does not use reads as switched off.
		<div
			className={`grid gap-x-8 gap-y-2 px-5 py-4 first:rounded-t-[inherit] last:rounded-b-[inherit] sm:grid-cols-[12rem_minmax(0,1fr)] ${empty ? "bg-sunken" : ""}`}
		>
			<dt className="min-w-0">
				<span
					className={`block text-sm font-medium ${empty ? "text-fg-2" : "text-fg"}`}
				>
					{row.label}
				</span>
				{row.key && (
					<code className="mt-0.5 block truncate font-mono text-2xs text-fg-3">
						{row.key}
					</code>
				)}
			</dt>
			<dd className="min-w-0">
				{(row.value !== undefined || empty) && (
					<div className="flex items-baseline gap-3">
						<span
							className={`min-w-0 flex-1 text-sm [overflow-wrap:anywhere] ${empty ? "text-fg-3" : `font-medium text-fg ${row.mono ? "font-mono" : "tnum"}`}`}
						>
							{empty ? "Not set" : row.value}
						</span>
						{row.ready !== undefined && (
							<Status
								status={row.ready ? "ready" : "missing"}
								className="shrink-0"
							/>
						)}
					</div>
				)}
				{row.items && (
					<ul className="space-y-2">
						{row.items.map((item) => (
							<ItemLine key={item.name} item={item} />
						))}
					</ul>
				)}
				<p className="mt-1.5 max-w-[68ch] text-sm text-pretty text-fg-2">
					{row.note}
				</p>
				{row.fix && <Fix command={row.fix} />}
			</dd>
		</div>
	);
}

const cmd = (text: string) => (
	<code className="font-mono text-xs text-fg">{text}</code>
);

/** The app never writes the factory: changing a setting happens in the code. */
function HowToEdit({ id, repository }: { id: string; repository: string }) {
	return (
		<div id={id} className="panel mb-8 px-5 py-4">
			<p className="text-sm font-medium text-fg">
				Settings change in the code, not here
			</p>
			<ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-fg-2 marker:text-fg-3">
				<li>
					Edit {cmd("openfabriq/factory.yaml")} in the repository, on your
					machine.
				</li>
				<li>Run {cmd("openfabriq plan")} to see what would change.</li>
				<li>
					Run {cmd("openfabriq apply")}. This page shows the new settings a few
					seconds later.
				</li>
			</ol>
			<a
				href={`https://github.com/${repository}/blob/HEAD/openfabriq/factory.yaml`}
				target="_blank"
				rel="noreferrer"
				className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent-text"
			>
				See factory.yaml on GitHub
				<ExternalLink className="size-3.5" aria-hidden />
			</a>
		</div>
	);
}

/** factory.yaml in full, as last applied, read only. */
export function FactoryYaml({
	open,
	yaml,
	repository,
	onClose,
}: {
	open: boolean;
	yaml: string;
	repository: string;
	onClose: () => void;
}) {
	return (
		<FileDialog
			open={open}
			path="openfabriq/factory.yaml"
			note="as last applied"
			text={yaml}
			repository={repository}
			onClose={onClose}
		/>
	);
}

/** What the factory's factory.yaml sets, read only: the app never changes the factory. */
export function Settings({
	project: repo,
	tab,
}: {
	project: string | undefined;
	tab: string | undefined;
}) {
	const [editing, setEditing] = useState(false);
	const [reading, setReading] = useState(false);
	const howTo = useId();
	const { data, error } = useApi<FactorySettings>(
		repo ? `/api/settings${query({ project: repo })}` : undefined,
		10_000,
	);

	if (!repo)
		return (
			<>
				<PageHeader title="Factory settings" />
				<Empty icon={<Settings2 />} title="Choose a project">
					Settings belong to a factory. Pick a project in the menu to see its
					limits, commands, secrets and connections.
				</Empty>
			</>
		);
	if (error && !data)
		return (
			<>
				<PageHeader title="Factory settings" />
				<ErrorNote>{error}</ErrorNote>
			</>
		);
	if (!data) return <PageSkeleton />;

	const sections = settingsSections(data);
	const current = sections.find((s) => s.id === tab) ?? sections[0];
	// What is missing, tab by tab, so the warning says where to look.
	const notReady = sections
		.map((section) => ({ section, names: missing([section]) }))
		.filter((m) => m.names.length > 0);
	const count = notReady.reduce((n, m) => n + m.names.length, 0);
	return (
		<>
			<PageHeader
				title="Factory settings"
				description={
					<>
						What <code className="font-mono text-xs">factory.yaml</code> of{" "}
						{data.name} sets, as last applied.
					</>
				}
			>
				{data.yaml && (
					<button
						type="button"
						className="btn"
						aria-haspopup="dialog"
						onClick={() => setReading(true)}
					>
						<FileText className="size-3.5 text-fg-2" aria-hidden />
						factory.yaml
					</button>
				)}
				<button
					type="button"
					className="btn aria-expanded:bg-hover"
					aria-expanded={editing}
					aria-controls={howTo}
					onClick={() => setEditing(!editing)}
				>
					<Pencil className="size-3.5 text-fg-2" aria-hidden />
					Edit
				</button>
			</PageHeader>
			{editing && <HowToEdit id={howTo} repository={data.repository} />}
			<FactoryYaml
				open={reading}
				yaml={data.yaml}
				repository={data.repository}
				onClose={() => setReading(false)}
			/>
			{notReady.length > 0 && (
				<div
					role="status"
					className="mb-6 flex items-start gap-2.5 rounded-xl border border-warn/25 bg-warn-soft px-4 py-3 text-sm text-fg"
				>
					<TriangleAlert
						className="mt-0.5 size-4 shrink-0 text-warn"
						aria-hidden
					/>
					<p className="min-w-0">
						Missing on this machine:{" "}
						{notReady.map(({ section, names }, i) => (
							<span key={section.id}>
								{i > 0 && "; "}
								<span className="font-medium">{names.join(", ")}</span>, in{" "}
								<a
									href={settingsHref(repo, section.id)}
									className="text-accent-text"
								>
									{section.title}
								</a>
							</span>
						))}
						. The engine cannot use {count === 1 ? "it" : "them"} until{" "}
						{count === 1 ? "it is" : "they are"} set; each one says how there.
					</p>
				</div>
			)}
			{current && (
				<>
					<Tabs
						label="Settings"
						tabs={sections.map((s) => ({ id: s.id, label: s.title }))}
						current={current.id}
						href={(t) => settingsHref(repo, t)}
					/>
					<p className="mb-3 max-w-[70ch] text-sm text-fg-2">{current.intro}</p>
					<dl className="panel divide-y divide-line">
						{current.rows.map((row) => (
							<SettingRow key={row.label} row={row} />
						))}
					</dl>
				</>
			)}
		</>
	);
}

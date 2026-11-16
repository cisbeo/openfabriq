import {
	ThreadListItemPrimitive,
	ThreadListPrimitive,
	useAuiState,
} from "@assistant-ui/react";
import { LoaderCircle, SquarePen, Trash2 } from "lucide-react";
import { useState } from "react";
import { ErrorNote, Skeleton } from "../../components/feedback.js";
import { ago, money } from "../../lib/format.js";
import { chats, type ProjectChats } from "./chat-store.js";

/** One past conversation in the list: its title, when, what it cost; delete in two clicks. */
function ThreadRow({
	project,
	chatsState,
	onRefused,
}: {
	project: string;
	chatsState: ProjectChats;
	onRefused: (error: string | undefined) => void;
}) {
	const id = useAuiState((s) => s.threadListItem.id);
	const [confirm, setConfirm] = useState(false);
	const summary = chatsState.list.find((t) => t.id === id);
	const current = chatsState.current === id;
	const running = Boolean(chatsState.threads[id]?.abort);
	return (
		<ThreadListItemPrimitive.Root
			className={`group/row relative flex items-center rounded-lg transition-colors duration-150 ${current ? "bg-panel shadow-1" : "hover:bg-hover"}`}
			onMouseLeave={() => setConfirm(false)}
		>
			<ThreadListItemPrimitive.Trigger className="min-w-0 flex-1 px-3 py-2 text-left">
				<span
					className={`block truncate text-sm ${current ? "font-medium text-fg" : "text-fg-2 group-hover/row:text-fg"}`}
				>
					<ThreadListItemPrimitive.Title fallback="New conversation" />
				</span>
				{summary && (
					<span className="tnum mt-0.5 flex items-center gap-1.5 text-2xs text-fg-3">
						{running ? (
							<span className="shimmer font-medium">Answering</span>
						) : (
							ago(summary.updatedAt)
						)}
						<span>·</span>
						{money(summary.costUsd)}
					</span>
				)}
			</ThreadListItemPrimitive.Trigger>
			{running ? (
				<LoaderCircle
					className="mr-3 size-3.5 shrink-0 animate-spin text-accent-text"
					aria-label="Answering"
				/>
			) : confirm ? (
				<button
					type="button"
					onClick={async () => onRefused(await chats.remove(project, id))}
					className="mr-1.5 h-7 shrink-0 rounded-md bg-bad px-2 text-xs font-medium text-white"
				>
					Delete
				</button>
			) : (
				<button
					type="button"
					aria-label="Delete this conversation"
					onClick={() => setConfirm(true)}
					className="mr-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-3 opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100"
				>
					<Trash2 className="size-3.5" aria-hidden />
				</button>
			)}
		</ThreadListItemPrimitive.Root>
	);
}

/** The past conversations with this factory, latest first. */
export function History({
	project,
	chatsState,
}: {
	project: string;
	chatsState: ProjectChats;
}) {
	const [refused, setRefused] = useState<string>();
	return (
		<ThreadListPrimitive.Root className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-14 shrink-0 items-center justify-between px-4">
				<h2 className="text-sm font-semibold">Conversations</h2>
				<ThreadListPrimitive.New
					aria-label="New conversation"
					title="New conversation"
					className="inline-flex size-8 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-hover hover:text-fg"
				>
					<SquarePen className="size-4" aria-hidden />
				</ThreadListPrimitive.New>
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
				{refused && (
					<div className="mb-2">
						<ErrorNote>{refused}</ErrorNote>
					</div>
				)}
				{!chatsState.listLoaded ? (
					<div className="space-y-2 px-2 pt-1">
						<Skeleton className="h-9" />
						<Skeleton className="h-9" />
						<Skeleton className="h-9" />
					</div>
				) : chatsState.list.length === 0 ? (
					<p className="px-3 pt-1 text-xs text-pretty text-fg-3">
						Your conversations with this factory are kept here, on this machine.
					</p>
				) : (
					<ThreadListPrimitive.Items>
						{() => (
							<ThreadRow
								project={project}
								chatsState={chatsState}
								onRefused={setRefused}
							/>
						)}
					</ThreadListPrimitive.Items>
				)}
			</div>
		</ThreadListPrimitive.Root>
	);
}

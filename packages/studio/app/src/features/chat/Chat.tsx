import {
	AssistantRuntimeProvider,
	AuiIf,
	ThreadPrimitive,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import {
	ArrowDown,
	History as HistoryIcon,
	MessageSquareDashed,
	SquarePen,
} from "lucide-react";
import { useState } from "react";
import { Messages } from "../../components/assistant-ui/thread.js";
import { Empty, ErrorNote, Skeleton } from "../../components/feedback.js";
import { Composer } from "./Composer.js";
import { chats, type ProjectChats, useProjectChats } from "./chat-store.js";
import { History } from "./History.js";
import { messageText, toThreadMessage } from "./to-thread.js";
import { Welcome } from "./Welcome.js";

function TopBar({
	project,
	chatsState,
	onHistory,
}: {
	project: string;
	chatsState: ProjectChats;
	onHistory: () => void;
}) {
	const title = chatsState.list.find((t) => t.id === chatsState.current)?.title;
	return (
		<div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4 sm:px-6">
			<button
				type="button"
				onClick={onHistory}
				aria-label="Conversations"
				className="-ml-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-hover hover:text-fg md:hidden"
			>
				<HistoryIcon className="size-4" aria-hidden />
			</button>
			<h1 className="min-w-0 truncate text-sm font-medium">
				{title ?? "New conversation"}
			</h1>
			<span className="hidden truncate font-mono text-xs text-fg-3 sm:inline">
				{project}
			</span>
			<button
				type="button"
				onClick={() => chats.start(project)}
				aria-label="New conversation"
				className="ml-auto inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-hover hover:text-fg md:hidden"
			>
				<SquarePen className="size-4" aria-hidden />
			</button>
		</div>
	);
}

function ChatRoom({
	project,
	projects,
}: {
	project: string;
	projects: string[];
}) {
	const chatsState = useProjectChats(project);
	const thread = chatsState.threads[chatsState.current];
	// On a phone the list and the thread take turns on the screen.
	const [listOpen, setListOpen] = useState(false);
	const suggestion = thread?.abort
		? undefined
		: thread?.messages.at(-1)?.turn?.suggestion;
	const runtime = useExternalStoreRuntime({
		messages: thread?.messages ?? [],
		suggestions: suggestion ? [{ prompt: suggestion }] : [],
		convertMessage: toThreadMessage,
		isRunning: Boolean(thread?.abort),
		// The store refuses a message while an old conversation loads: the composer waits too.
		isSendDisabled: !thread?.loaded,
		onNew: async (message) => {
			const text = messageText(message);
			if (text) await chats.send(project, text);
		},
		onCancel: async () => chats.cancel(project),
		adapters: {
			threadList: {
				threadId: chatsState.current,
				threads: chatsState.list.map((t) => ({
					status: "regular" as const,
					id: t.id,
					title: t.title,
				})),
				onSwitchToNewThread: () => {
					setListOpen(false);
					chats.start(project);
				},
				onSwitchToThread: (id) => {
					setListOpen(false);
					chats.select(project, id);
				},
				onDelete: async (id) => {
					const refused = await chats.remove(project, id);
					if (refused) throw new Error(refused);
				},
			},
		},
	});
	const loading = thread && !thread.loaded;

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<div className="flex h-[calc(100dvh-89px)] min-h-0 md:h-[calc(100dvh-3.5rem)]">
				<aside
					className={`w-full shrink-0 flex-col border-line bg-sunken/60 md:flex md:w-72 md:border-r ${listOpen ? "flex" : "hidden"}`}
				>
					<History project={project} chatsState={chatsState} />
				</aside>
				<ThreadPrimitive.Root
					className={`min-w-0 flex-1 flex-col md:flex ${listOpen ? "hidden" : "flex"}`}
				>
					<TopBar
						project={project}
						chatsState={chatsState}
						onHistory={() => setListOpen(true)}
					/>
					<ThreadPrimitive.Viewport className="flex flex-1 flex-col overflow-y-auto">
						{thread?.error ? (
							<div className="mx-auto w-full max-w-[760px] px-4 pt-10 sm:px-6">
								<ErrorNote>{thread.error}</ErrorNote>
							</div>
						) : loading ? (
							<div className="mx-auto w-full max-w-[760px] space-y-6 px-4 pt-10 sm:px-6">
								<Skeleton className="ml-auto h-10 w-2/5 rounded-2xl" />
								<Skeleton className="h-4 w-4/5" />
								<Skeleton className="h-4 w-3/5" />
								<Skeleton className="h-24" />
							</div>
						) : (
							<AuiIf condition={(s) => s.thread.isEmpty}>
								<Welcome project={project} />
							</AuiIf>
						)}
						<div className="mx-auto w-full max-w-[760px] space-y-8 px-4 pt-8 sm:px-6">
							<Messages footer />
						</div>
						<ThreadPrimitive.ViewportFooter className="sticky bottom-0 mx-auto mt-auto w-full max-w-[760px] bg-gradient-to-t from-bg from-60% to-transparent px-4 pt-8 pb-4 sm:px-6">
							<ThreadPrimitive.ScrollToBottom
								aria-label="Scroll to the latest message"
								className="absolute -top-4 left-1/2 inline-flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-panel text-fg-2 shadow-2 transition-opacity hover:text-fg disabled:pointer-events-none disabled:opacity-0"
							>
								<ArrowDown className="size-4" aria-hidden />
							</ThreadPrimitive.ScrollToBottom>
							<Composer project={project} projects={projects} />
						</ThreadPrimitive.ViewportFooter>
					</ThreadPrimitive.Viewport>
				</ThreadPrimitive.Root>
			</div>
		</AssistantRuntimeProvider>
	);
}

export function Chat({
	project,
	projects,
}: {
	project: string | undefined;
	projects: string[];
}) {
	const chosen = project ?? projects[0];
	if (!chosen)
		return (
			<div className="px-4 py-10 sm:px-8">
				<Empty icon={<MessageSquareDashed />} title="No project to talk about">
					The chat answers about one factory. Apply one with{" "}
					<code className="font-mono text-xs">openfabriq apply</code>, then come
					back.
				</Empty>
			</div>
		);
	return <ChatRoom key={chosen} project={chosen} projects={projects} />;
}

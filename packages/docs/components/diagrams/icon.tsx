// Icons for the docs' diagrams, drawn like lucide's: one path each, on a 24-unit grid.

const ICONS = {
	event:
		"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0",
	you: "M18 20a6 6 0 0 0-12 0M12 10m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
	pr: "M18 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M6 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M13 6h3a2 2 0 0 1 2 2v7M6 9v12",
	clock: "M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0M12 6v6l4 2",
	chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
	folder:
		"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
	laptop:
		"M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16",
	server:
		"M4 2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM4 14h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zM6 6h.01M6 18h.01",
	cloud: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z",
	inbox:
		"M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
	github:
		"M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4M9 18c-4.51 2-5-2-7-2",
	bolt: "M13 2 3 14h9l-1 8 10-12h-9l1-8z",
	bug: "m8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4",
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({
	name,
	className = "size-4",
}: {
	name: IconName;
	className?: string;
}) {
	return (
		<svg
			viewBox="0 0 24 24"
			className={`shrink-0 fill-none stroke-current ${className}`}
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d={ICONS[name]} />
		</svg>
	);
}

/** A run's duration as the studio writes it: 65 → "1m 05s". */
export const formatDuration = (seconds: number) =>
	`${Math.floor(seconds / 60)}m ${String(Math.max(0, seconds) % 60).padStart(2, "0")}s`;

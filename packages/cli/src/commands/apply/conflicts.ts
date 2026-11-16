import { type Factory, sameName } from "@openfabriq/core";

/**
 * The relay, the Linear app and the Slack bot are one per machine: what comes through them goes to
 * every factory that declares it. The relay knows a webhook by its name only, so a name
 * two factories share would mix their secrets: refused. A shared Linear team or Slack channel may
 * be wanted: a warning.
 */
export function sharedWithOthers(
	factory: Factory,
	others: Factory[],
): { refused: string[]; warnings: string[] } {
	const refused: string[] = [];
	const warnings: string[] = [];
	for (const other of others) {
		if (other.repository === factory.repository) continue;
		for (const name of Object.keys(factory.webhooks ?? {}))
			if (other.webhooks?.[name])
				refused.push(
					`✗ The webhook ${name} is also declared by ${other.repository}, and the relay of this machine knows a webhook by its name only: rename it in one of them.`,
				);
		const team = factory.linear?.team;
		if (team && sameName(team, other.linear?.team))
			warnings.push(
				`! The Linear team ${team} is also the team of ${other.repository}: its issues start runs in both factories.`,
			);
		const channel = factory.slack?.channel;
		if (channel && sameName(channel, other.slack?.channel))
			warnings.push(
				`! The Slack channel #${channel} is also the channel of ${other.repository}: a mention starts a run in both factories.`,
			);
	}
	return { refused, warnings };
}

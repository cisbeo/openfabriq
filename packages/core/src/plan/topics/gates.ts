import type { Factory } from "../../factory/types.js";
import { includesName } from "../../vocabulary.js";
import type { PlanTopic } from "./topic.js";

// Who and what can start automations: webhooks, the places outside GitHub, the maintainers.

const hookText = (signature: string) =>
	signature === "none"
		? "not signed: anyone who has its address can start automations"
		: `signed (${signature}); a signed request can now start automations`;

/** The webhooks: a request from the Internet can start a run, so the signature is the gate. */
export function webhooks(
	before: Factory | undefined,
	after: Factory,
): PlanTopic {
	const security: string[] = [];
	const settings: string[] = [];
	for (const [name, hook] of Object.entries(after.webhooks ?? {}).sort()) {
		const old = before?.webhooks?.[name];
		if (old?.signature === hook.signature) continue;
		security.push(
			old
				? `~ webhook ${name}: ${hookText(hook.signature)}`
				: `+ webhook ${name}, ${hookText(hook.signature)} ("openfabriq connect webhook ${name}")`,
		);
	}
	for (const name of Object.keys(before?.webhooks ?? {}).sort())
		if (!after.webhooks?.[name])
			settings.push(
				`- webhook ${name}; the relay accepts it until "openfabriq connect webhook ${name} --remove"`,
			);
	return { security, settings };
}

const sentryText = (f?: Factory) =>
	f?.sentry &&
	`project ${f.sentry.organization}/${f.sentry.project}${f.sentry.url ? ` on ${f.sentry.url}` : ""}`;

/** Where the factory listens outside GitHub (Slack, Linear, Sentry): the place is the gate. */
export function integrationChanges(
	before: Factory | undefined,
	after: Factory,
): PlanTopic {
	const security: string[] = [];
	const settings: string[] = [];
	const places = [
		[
			"slack",
			before?.slack && `channel #${before.slack.channel}`,
			after.slack && `channel #${after.slack.channel}`,
			"people in the channel can now start automations",
		],
		[
			"linear",
			before?.linear && `team ${before.linear.team}`,
			after.linear && `team ${after.linear.team}`,
			"people of the team can now start automations",
		],
		[
			"sentry",
			sentryText(before),
			sentryText(after),
			"its new issues can now start automations",
		],
	] as const;
	for (const [key, a, b, effect] of places)
		if (b && a !== b)
			security.push(
				a
					? `~ ${key}: ${a} → ${b}; ${effect}`
					: `+ ${key}: ${b}; ${effect}, through the relay ("openfabriq connect ${key}")`,
			);
		else if (a && !b) settings.push(`- ${key}: ${a}`);
	return { security, settings };
}

/** Who can start automations. */
export function maintainerChanges(
	before: Factory | undefined,
	after: Factory,
): PlanTopic {
	const security: string[] = [];
	const settings: string[] = [];
	for (const m of after.maintainers)
		if (!includesName(before?.maintainers, m))
			security.push(`+ maintainer ${m} can now start automations`);
	for (const m of before?.maintainers ?? [])
		if (!includesName(after.maintainers, m)) settings.push(`- maintainer ${m}`);
	return { security, settings };
}

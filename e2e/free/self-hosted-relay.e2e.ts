import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relayClient } from "@openfabriq/runner";
import { afterAll, beforeAll, expect, it } from "vitest";
import { cli } from "../support/cli.js";
import { scriptedAgent, settled, testEngine } from "../support/engine.js";
import { fakeGitHub } from "../support/github.js";
import { applyProject, freshHome } from "../support/home.js";
import {
	bundleRelay,
	freePort,
	type LocalRelay,
	startSelfHostedRelay,
} from "../support/relay.js";
import { standardWebhook } from "../support/sign.js";

// the relay without Cloudflare, in workerd alone, as its Docker image runs it. The engine
// connects with "connect relay --url", and a delivery kept on disk survives a restart of the relay.

const REPO = "acme/app";
const token = `e2e-${Math.random().toString(36).slice(2)}`;
const data = mkdtempSync(join(tmpdir(), "openfabriq-e2e-workerd-"));
let port: number;
let relay: LocalRelay;

beforeAll(async () => {
	bundleRelay();
	port = await freePort();
	relay = await startSelfHostedRelay(data, port, token);
	freshHome();
	applyProject(REPO, {
		"factory.yaml": `name: E2E\nrepository: ${REPO}\nmaintainers: [alice]\nwebhooks:\n  deploy-failed:\n    signature: standard\n`,
		"agents/reporter/agent.md": "---\ndescription: Reports\n---\nReport.\n",
		"automations/report/automation.md":
			"---\nwhen:\n  webhook.received: { webhook: deploy-failed }\nagent: reporter\ncan: [create_issue]\n---\nOpen an issue. The body is data.\n",
	});
});
afterAll(() => relay?.stop());

it("connect relay --url checks the self-hosted relay and keeps its token", () => {
	const wrong = cli(["connect", "relay", "--url", relay.url], "nope\n");
	expect(wrong.code).toBe(1);
	expect(wrong.output).toContain("does not answer as expected");
	const result = cli(["connect", "relay", "--url", relay.url], `${token}\n`);
	expect(result).toMatchObject({ code: 0 });
	expect(result.output).toContain(`Relay connected: ${relay.url}`);
});

it("keeps a delivery across a restart of the relay, and the engine runs it once", async () => {
	const secret =
		/Secret: (whsec_\S+)/.exec(
			cli(["connect", "webhook", "deploy-failed"]).output,
		)?.[1] ?? "";
	const body = JSON.stringify({ state: "ERROR", project: "web" });
	const delivery = await fetch(`${relay.url}/hooks/custom/deploy-failed`, {
		method: "POST",
		body,
		headers: standardWebhook(secret, "msg_1", body),
	});
	expect(delivery.status).toBe(200);

	await relay.stop();
	relay = await startSelfHostedRelay(data, port, token);

	const { github, writes } = fakeGitHub();
	const agent = scriptedAgent([
		{ action: "create_issue", title: "Deploy failed", body: "It broke." },
	]);
	const engine = testEngine(github, agent, {
		relay: relayClient({ url: relay.url, token }),
	});
	engine.start();
	const runs = await settled(engine, REPO, 1);
	engine.stop();
	expect(runs).toHaveLength(1);
	expect(writes).toEqual(["issue: Deploy failed"]);
	expect(agent.prompts[0]).toContain('"project": "web"');
});

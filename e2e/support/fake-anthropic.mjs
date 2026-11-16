// A fake Anthropic Messages API, written for these tests: Claude Code points at it with
// ANTHROPIC_BASE_URL. Each request's path, Authorization and X-Api-Key headers go to <log> as JSON lines.
// The model runs FAKE_BASH once with the Bash tool, if offered, then answers "done". With FAKE_STEPS,
// a JSON list of tool calls ({ name, input }), it makes them one per turn instead; "$LAST" in a
// call's input stands for the last line the previous call returned.
//   node fake-anthropic.mjs <port> <log>
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const [port, log] = process.argv.slice(2);
const STEPS = process.env.FAKE_STEPS
	? JSON.parse(process.env.FAKE_STEPS)
	: [
			{
				name: "Bash",
				input: {
					command: process.env.FAKE_BASH ?? "echo hello",
					description: "probe",
				},
			},
		];

const results = (messages) =>
	messages
		.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
		.filter((b) => b.type === "tool_result")
		.map((b) =>
			typeof b.content === "string"
				? b.content
				: (b.content ?? []).map((c) => c.text ?? "").join(""),
		);

function reply(body) {
	const done = results(body.messages ?? []);
	const step = STEPS[done.length];
	const offered = step && (body.tools ?? []).some((t) => t.name === step.name);
	const last = (done.at(-1) ?? "").trim().split("\n").at(-1) ?? "";
	return offered
		? {
				stop: "tool_use",
				block: {
					type: "tool_use",
					id: `toolu_e2e_${done.length}`,
					name: step.name,
					input: JSON.parse(
						JSON.stringify(step.input).replaceAll("$LAST", last),
					),
				},
			}
		: { stop: "end_turn", block: { type: "text", text: "done" } };
}

const message = (stop, content) => ({
	id: "msg_e2e",
	type: "message",
	role: "assistant",
	model: "claude-haiku-4-5",
	content,
	stop_reason: stop,
	stop_sequence: null,
	usage: { input_tokens: 1, output_tokens: 1 },
});

function stream(res, { stop, block }) {
	const send = (type, data) =>
		res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	res.writeHead(200, { "content-type": "text/event-stream" });
	send("message_start", { message: message(null, []) });
	if (block.type === "text") {
		send("content_block_start", {
			index: 0,
			content_block: { type: "text", text: "" },
		});
		send("content_block_delta", {
			index: 0,
			delta: { type: "text_delta", text: block.text },
		});
	} else {
		send("content_block_start", {
			index: 0,
			content_block: { ...block, input: {} },
		});
		send("content_block_delta", {
			index: 0,
			delta: {
				type: "input_json_delta",
				partial_json: JSON.stringify(block.input),
			},
		});
	}
	send("content_block_stop", { index: 0 });
	send("message_delta", {
		delta: { stop_reason: stop, stop_sequence: null },
		usage: { output_tokens: 1 },
	});
	send("message_stop", {});
	res.end();
}

createServer((req, res) => {
	let raw = "";
	req.on("data", (chunk) => {
		raw += chunk;
	});
	req.on("end", () => {
		appendFileSync(
			log,
			`${JSON.stringify({ path: req.url, authorization: req.headers.authorization ?? "", apiKey: req.headers["x-api-key"] ?? "" })}\n`,
		);
		if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
			res.writeHead(404, { "content-type": "application/json" });
			return res.end('{"type":"error","error":{"type":"not_found_error"}}');
		}
		const body = JSON.parse(raw || "{}");
		if (req.url.startsWith("/v1/messages/count_tokens")) {
			res.writeHead(200, { "content-type": "application/json" });
			return res.end('{"input_tokens":1}');
		}
		const answer = reply(body);
		if (body.stream) return stream(res, answer);
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify(message(answer.stop, [answer.block])));
	});
}).listen(Number(port), "127.0.0.1");

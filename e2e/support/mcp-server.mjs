// A small MCP server for the end-to-end tests: stdio by default, HTTP with `http <port>`.
// Tools: echo, add, print_env. Each call is logged to MCP_LOG, with whether its secret arrived.
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const log = (line) =>
	process.env.MCP_LOG && appendFileSync(process.env.MCP_LOG, `${line}\n`);
const tools = [
	{
		name: "echo",
		description: "Returns the text it is given.",
		inputSchema: {
			type: "object",
			properties: { text: { type: "string" } },
			required: ["text"],
		},
	},
	{
		name: "add",
		description: "Adds two numbers.",
		inputSchema: {
			type: "object",
			properties: { a: { type: "number" }, b: { type: "number" } },
		},
	},
	{
		name: "print_env",
		description: "Prints this server's environment, secrets included.",
		inputSchema: { type: "object", properties: {} },
	},
];

function answer(message, who) {
	if (message.id === undefined) return null;
	const reply = (result) => ({ jsonrpc: "2.0", id: message.id, result });
	if (message.method === "initialize")
		return reply({
			protocolVersion: message.params.protocolVersion,
			capabilities: { tools: {} },
			serverInfo: { name: `e2e-${who}`, version: "1" },
		});
	if (message.method === "tools/list") return reply({ tools });
	if (message.method === "tools/call") {
		const { name, arguments: args = {} } = message.params;
		log(`${who} call ${name} ${JSON.stringify(args)}`);
		const text =
			name === "echo"
				? `${who} echo: ${args.text}`
				: name === "add"
					? String(args.a + args.b)
					: JSON.stringify(process.env);
		return reply({ content: [{ type: "text", text }] });
	}
	return reply({});
}

if (process.argv[2] === "http") {
	const token = process.env.MCP_EXPECTED_TOKEN;
	createServer((request, response) => {
		let body = "";
		request.on("data", (c) => {
			body += c;
		});
		request.on("end", () => {
			if (request.method !== "POST") return response.writeHead(405).end();
			if (request.headers.authorization !== `Bearer ${token}`) {
				log("remote refused: no token");
				return response.writeHead(401).end();
			}
			const out = answer(JSON.parse(body), "remote");
			if (!out) return response.writeHead(202).end();
			response
				.writeHead(200, { "content-type": "application/json" })
				.end(JSON.stringify(out));
		});
	}).listen(Number(process.argv[3]), "127.0.0.1", () =>
		log("remote listening"),
	);
} else {
	log(
		`local started, secret ${process.env.E2E_DB_URL?.startsWith("canary-db-") ? "received" : "missing"}`,
	);
	let buffer = "";
	process.stdin.on("data", (chunk) => {
		buffer += chunk;
		for (let i = buffer.indexOf("\n"); i >= 0; i = buffer.indexOf("\n")) {
			const line = buffer.slice(0, i);
			buffer = buffer.slice(i + 1);
			if (!line.trim()) continue;
			const out = answer(JSON.parse(line), "local");
			if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
		}
	});
}

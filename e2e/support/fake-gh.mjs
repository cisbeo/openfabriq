// gh for the e2e tests of the CLI: answers what init, plan, apply and start ask GitHub about one
// repository, E2E_REPOSITORY, and clones it from E2E_ORIGIN, a local bare repository.
// Each call is recorded in E2E_CALLS. Anything else fails, so a new call shows up in a test.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const calls = process.env.E2E_CALLS;
appendFileSync(calls, `gh ${args.join(" ")}\n`);
const repository = process.env.E2E_REPOSITORY ?? "acme/app";
const [command, target] = args;
const print = (text) => process.stdout.write(text);
// The repository's labels: "bug", then those created.
const labelsFile = `${calls}.labels`;
const labels = () => [
	"bug",
	...(existsSync(labelsFile)
		? readFileSync(labelsFile, "utf8").split("\n").filter(Boolean)
		: []),
];

if (command === "api" && target === `repos/${repository}`)
	print(JSON.stringify({ default_branch: "main" }));
else if (command === "api" && target?.startsWith(`repos/${repository}/labels`))
	// --paginate --slurp: one array per page.
	print(JSON.stringify([labels().map((name) => ({ name }))]));
else if (command === "api" && target === "user") print("alice\n");
else if (command === "repo" && target === "view") print(`${repository}\n`);
else if (command === "label" && target === "create")
	appendFileSync(labelsFile, `${args[2]}\n`);
else if (command === "repo" && target === "clone")
	execFileSync("git", ["clone", "--quiet", process.env.E2E_ORIGIN, args[3]]);
else {
	process.stderr.write(`fake gh: not faked: gh ${args.join(" ")}\n`);
	process.exit(1);
}

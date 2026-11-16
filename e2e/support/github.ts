import type { GitHub } from "@openfabriq/runner";

/** GitHub as the engine sees it, where every write is only recorded. Reads return nothing. */
export function fakeGitHub(): { github: GitHub; writes: string[] } {
	const writes: string[] = [];
	const no = async () => {
		throw new Error("not used in this test");
	};
	let issue = 100;
	const github: GitHub = {
		currentUser: async () => "e2e-bot",
		defaultBranch: async () => "main",
		labels: async () => [],
		createLabel: no,
		clone: no,
		issuesUpdatedSince: async () => [],
		timeline: no,
		openPulls: async () => [],
		commitAuthor: no,
		branchHead: async () => "head",
		changedFiles: no,
		commitFiles: no,
		jobLog: no,
		subject: no,
		reviews: async () => [],
		comment: async (_repo, number, body) => {
			writes.push(`comment #${number}: ${body.slice(0, 60)}`);
			return `https://github.com/acme/app/issues/${number}#comment`;
		},
		addLabels: async (_repo, number, labels) => {
			writes.push(`labels #${number}: ${labels.join(", ")}`);
		},
		removeLabel: async (_repo, number, label) => {
			writes.push(`unlabel #${number}: ${label}`);
			return true;
		},
		createPullRequest: async (_repo, pull) => {
			writes.push(`pull request ${pull.head}: ${pull.title}`);
			return "https://github.com/acme/app/pull/7";
		},
		review: async (_repo, number) => {
			writes.push(`review #${number}`);
			return `https://github.com/acme/app/pull/${number}#review`;
		},
		createIssue: async (_repo, created) => {
			writes.push(`issue: ${created.title}`);
			return `https://github.com/acme/app/issues/${++issue}`;
		},
		close: async (_repo, number) => {
			writes.push(`close #${number}`);
		},
		mergeMethod: async () => "squash",
		branchRed: async () => false,
		merge: async (_repo, number, { sha, auto }) => {
			writes.push(`merge #${number} at ${sha}${auto ? " (auto)" : ""}`);
		},
		disableAutoMerge: async (_repo, number) => {
			writes.push(`disable auto-merge #${number}`);
		},
	};
	return { github, writes };
}

import { exec, githubEnv } from "@openfabriq/runner";

/** A merged pull request of a repository, whoever opened it, as GitHub tells. */
export interface MergedPull {
	url: string;
	mergedAt: string;
	/** Its commits' ids, 100 at most. */
	commits: string[];
	/** When the issue it closes was opened; absent when it closes none. */
	issueOpenedAt?: string;
}

/** A repository's latest merged pull requests; empty when gh cannot tell. */
export type MergedPulls = (repository: string) => Promise<MergedPull[]>;

const GH_TIMEOUT_MS = 30_000;
/** A repository's merged pull requests are asked about again after this. */
const ASK_AGAIN_MS = 10 * 60_000;

// Fields checked with gh against GitHub's GraphQL API on 2026-11-16.
const QUERY = `query ($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        url
        mergedAt
        commits(first: 100) { nodes { commit { oid } } }
        closingIssuesReferences(first: 1) { nodes { createdAt } }
      }
    }
  }
}`;

interface Node {
	url: string;
	mergedAt: string;
	commits: { nodes: { commit: { oid: string } }[] };
	closingIssuesReferences: { nodes: { createdAt: string }[] };
}

/**
 * The repository's 100 latest merged pull requests, read only through gh, with the repository's
 * token in app mode. Throws when gh cannot tell.
 * shortcut: one page of 100; page through `pullRequests` if a team merges more than that in the 90 days compared.
 */
export async function githubMergedPulls(
	repository: string,
): Promise<MergedPull[]> {
	const [owner = "", name = ""] = repository.split("/");
	const env = await githubEnv(repository);
	const out = JSON.parse(
		await exec(
			"gh",
			[
				"api",
				"graphql",
				// -f, not -F: -F turns "2048" into a number and "@x" into a file's content.
				"-f",
				`owner=${owner}`,
				"-f",
				`name=${name}`,
				"-f",
				`query=${QUERY}`,
			],
			{ ...(env ? { env } : {}), timeoutMs: GH_TIMEOUT_MS },
		),
	) as { data: { repository: { pullRequests: { nodes: Node[] } } } };
	return out.data.repository.pullRequests.nodes.map((n) => {
		const issue = n.closingIssuesReferences.nodes[0];
		return {
			url: n.url,
			mergedAt: n.mergedAt,
			commits: n.commits.nodes.map((c) => c.commit.oid),
			...(issue ? { issueOpenedAt: issue.createdAt } : {}),
		};
	});
}

/**
 * `ask`, kept ten minutes per repository; one question at a time per repository. A failed
 * answer is empty and asked again next time: a passing gh error does not hide the gains.
 */
export function cachedMergedPulls(
	ask: MergedPulls = githubMergedPulls,
): MergedPulls {
	const cache = new Map<string, { at: number; pulls: Promise<MergedPull[]> }>();
	return (repository) => {
		const hit = cache.get(repository);
		if (hit && Date.now() - hit.at < ASK_AGAIN_MS) return hit.pulls;
		const pulls = ask(repository).catch(() => {
			cache.delete(repository);
			return [];
		});
		cache.set(repository, { at: Date.now(), pulls });
		return pulls;
	};
}

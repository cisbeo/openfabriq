import { GITHUB } from "./layout.shared";

/**
 * The prompt a visitor pastes into Claude Code, on their own computer, to install the engine on
 * their Coolify through Coolify's API. The credentials reach the agent as environment variables it
 * uses by name, never as text: it must not print them, and the person has exported them in the
 * terminal that starts Claude Code. Routes: coollabsio/coolify, routes/api.php.
 */
export const COOLIFY_PROMPT = `Install the openfabriq engine on my Coolify, through Coolify's API. openfabriq runs AI agents described in an openfabriq/ folder of GitHub repositories; the engine is one Docker Compose application, built from this repository: ${GITHUB}

Go step by step. Coolify's address is in $COOLIFY_URL and its API token in $COOLIFY_TOKEN; the Claude and GitHub credentials are in $ANTHROPIC_API_KEY (or $CLAUDE_CODE_OAUTH_TOKEN) and $GITHUB_APP_ID and $GITHUB_APP_PRIVATE_KEY, my team's GitHub App (or $GH_TOKEN, a token, without an app). Use them only by name inside commands (curl, jq --arg): never print them, never write them to a file, never put their value in a command or in this conversation, and never run env or printenv. Never change or delete anything in Coolify that you did not create in this session. When something is missing or fails, tell me what and stop.

1. Check that those variables are set (print only "set" or "not set"). Then call \`GET $COOLIFY_URL/api/v1/version\` with the token as a bearer. A 401 or 403 means that API access is off in Coolify, or that the token lacks the abilities read, write, deploy and read:sensitive: tell me and stop.

2. Ask me, in one message: which GitHub repositories the engine runs (owner/name, comma-separated; each needs an openfabriq/ folder on its default branch); only without a GitHub App, what name and email the factory's commits carry (a bot name makes it clear; the app's commits carry its name); and what Coolify should call the application. Then list the servers (\`GET /servers\`), the projects (\`GET /projects\`) and the project's environments, and ask me which to use, unless there is only one.

3. Create the application from ${GITHUB}, branch main, build pack dockercompose, Docker Compose location /docker-compose.yml, base directory /, without instant_deploy and without a domain. If the repository is public: \`POST /applications/public\`. If it is private, list \`GET /github-apps\` and \`GET /security/keys\`, ask me which to use, then \`POST /applications/private-github-app\` or \`POST /applications/private-deploy-key\`. If the deployment then fails with "Repository not found" with a deploy key, the GitHub organization may forbid deploy keys (its Settings, Deploy keys): tell me, and stop. The fields are in https://coolify.io/docs/api.

4. Add the environment variables to that application (\`POST /applications/{uuid}/envs\`, or \`PATCH /applications/{uuid}/envs/bulk\`): OPENFABRIQ_REPOSITORIES, and without a GitHub App GIT_USER_NAME and GIT_USER_EMAIL, from my answers, and the secrets GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (or GH_TOKEN) and ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN), whose value comes from the variable of the same name through \`jq --arg\`. Mark the secrets as hidden after creation if the API allows it. Then list the variables (\`GET /applications/{uuid}/envs\`) and tell me which names are there, never their values.

5. Deploy (\`POST /deploy\` with the application's uuid; the call is in the API documentation), follow \`GET /deployments/{deployment_uuid}\` until it ends, then read \`GET /applications/{uuid}/logs\`. Report each line that starts with ✗ (it comes from \`openfabriq doctor\`, with its fix) and any "was not applied". Never show a line that contains a credential.

6. Finish with what runs, what is left for me, and nothing else. Left for me: if a factory's factory.yaml lists secrets, the API cannot give them to the engine; I run \`openfabriq secret set <NAME> --project <owner/repo>\` in the application's terminal in Coolify. Also the studio's password and domain, and the relay for Slack and Linear: both are in the documentation's Docker page.`;

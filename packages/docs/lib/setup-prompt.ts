import { GITHUB } from "./layout.shared";

const OWNER = GITHUB.split("/").at(-2) ?? "openfabriq";

const ABOUT = `openfabriq runs AI agents described in an openfabriq/ folder of a repository, on this machine, with Claude Code and the gh CLI: ${GITHUB}`;

const RULES =
	"Do everything yourself, step by step: run the commands, do not hand them to me. Stop only for what you cannot do: a command that asks for my password (sudo), a login in my browser, or a choice that is mine. Then give me the exact command or question, wait for my answer, and go on. Never print a token or a password.";

/** Checking the machine, installing openfabriq and what it needs, and the logins: the first steps of both prompts. */
const MACHINE = (
	first: number,
) => `${first}. Check that this machine runs macOS or Linux. On Windows, stop: openfabriq does not run there.

${first + 1}. Install what is missing:
   - openfabriq, if \`command -v openfabriq\` finds nothing: with Homebrew when \`brew\` exists, \`brew install ${OWNER}/tap/openfabriq\`, which also installs Node and the GitHub CLI; otherwise \`npm install -g openfabriq\`, which needs Node 24 or later (\`node --version\`; if Node is missing or older, tell me how to install it). If npm refuses to write its global folder, do not use sudo: tell me.
   - the GitHub CLI, if \`command -v gh\` finds nothing: \`brew install gh\`, or on Linux the command for my distribution (it needs sudo).
   - on Linux, the sandbox of the agents' shell: bubblewrap, socat and ripgrep (\`sudo apt install bubblewrap socat ripgrep\` on Debian and Ubuntu).
   \`openfabriq\` with no arguments then lists its commands.

${first + 2}. The logins. Claude Code is logged in already, since you run in it. If \`gh auth status\` says I am not logged in, ask me to run \`gh auth login\` in my terminal (it opens my browser) and wait. If \`git config user.name\` or \`git config user.email\` is empty, ask me for the name and email the commits should carry, and set them with \`git config --global\`.

${first + 3}. Run \`openfabriq doctor\`. It checks the logins, the git identity and, on Linux, the sandbox tools. Fix each ✗ line yourself when you can, as above; otherwise give me its fix and wait.`;

/**
 * The prompt of the Install page: it checks the machine, installs openfabriq and checks the
 * logins, then stops. Writing the factory is the setup prompt's.
 */
export const MACHINE_PROMPT = `Install openfabriq on this machine. ${ABOUT}

${RULES}

${MACHINE(1)} It also says there is no factory here: that is expected.

5. Finish with what is ready, then the next step: \`openfabriq init\` in my repository, which writes the factory with Claude Code.`;

/**
 * The prompt a visitor pastes into Claude Code, in their repository: it installs openfabriq and
 * what it needs, then writes and saves a first factory with them through the setup skill, which
 * it runs itself because `openfabriq init` needs an interactive terminal. `openfabriq start` is
 * left to the person: it runs for a long time, and applying writes labels to GitHub.
 */
export const SETUP_PROMPT = `Set up openfabriq in this repository, from nothing to a first factory. ${ABOUT}

${RULES}

First check that this folder is a git repository with a GitHub remote (\`git remote -v\`). If it is not, stop and tell me.

${MACHINE(1)} It also says openfabriq/ is missing: that is expected here.

5. Write the first factory. \`openfabriq init\` needs an interactive terminal, so do its work yourself: read the setup skill shipped with openfabriq, and the reference.md beside it, then follow it to the end. The openfabriq command is \`openfabriq\`.
   "$(dirname "$(realpath "$(command -v openfabriq)")")/../plugin/skills/setup/SKILL.md"
   It asks me a few questions, writes openfabriq/, validates it, explains the plan, security changes first, and pushes openfabriq/ to the default branch once I say yes.

6. Finish with the one command left for me, in a terminal I keep open: \`openfabriq start\`, in this repository. It applies the factory once I answer \`y\`, then runs the agents, with a board at the address it prints. Then tell me how to try it, as the setup skill says.`;

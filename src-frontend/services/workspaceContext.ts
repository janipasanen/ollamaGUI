/**
 * Workspace grounding for the system prompt (#489, #491).
 *
 * Without this the model is told nothing about its environment: asked "what
 * open issues are there for this project?" with a folder open, it replied
 * "Could you clarify which project you're referring to?" and guessed at the
 * public Ollama repo. composeSystemPrompt() previously stacked only the rules
 * file, project instructions and memory — never the workspace path, the project
 * name, or the fact that shell/git tooling exists.
 *
 * Everything here is *observed*, never assumed: the CLI list contains only
 * binaries actually found on PATH, and the remote only what git reports. When
 * no workspace is open we emit nothing rather than inventing a context.
 */

export interface WorkspaceContext {
  /** Absolute path of the open workspace root. */
  root: string;
  /** Active project name, when a project is bound to this root. */
  projectName?: string;
  /** `git remote get-url origin`, when the root is a git repo with a remote. */
  gitRemote?: string;
  /** Current branch, when known. */
  gitBranch?: string;
  /** Repo-question CLIs found on PATH, e.g. ['gh', 'git']. */
  availableClis: string[];
}

/** Human-readable hint for each CLI we advertise. Only used when detected. */
const CLI_HINTS: Record<string, string> = {
  gh: '`gh` (GitHub CLI) — e.g. `gh issue list`, `gh pr list`, `gh repo view`',
  glab: '`glab` (GitLab CLI) — e.g. `glab issue list`, `glab mr list`',
  git: '`git` — e.g. `git log`, `git status`, `git branch`',
};

/**
 * Render the workspace block prepended to the system prompt.
 * Returns '' when there is no workspace, so nothing is fabricated.
 */
export function formatWorkspaceContext(ctx: WorkspaceContext | null): string {
  if (!ctx?.root) return '';

  const lines: string[] = ['--- Workspace ---'];
  if (ctx.projectName) lines.push(`Project: ${ctx.projectName}`);
  lines.push(`Working directory: ${ctx.root}`);
  if (ctx.gitRemote) lines.push(`Git remote: ${ctx.gitRemote}`);
  if (ctx.gitBranch) lines.push(`Git branch: ${ctx.gitBranch}`);

  lines.push(
    '',
    'When the user says "this project", "this repo", or "here", they mean the working directory above.',
    'File, search and Git tools operate inside it — read the actual files rather than guessing or asking which project is meant.',
  );

  const clis = ctx.availableClis.filter(c => CLI_HINTS[c]);
  if (clis.length > 0) {
    lines.push(
      '',
      'These command-line tools are installed and available via the shell tool, which runs in the working directory above:',
      ...clis.map(c => `  - ${CLI_HINTS[c]}`),
      'Prefer running one of these to answer questions about issues, pull requests, branches or history, instead of asking the user for a repository.',
    );
  }

  lines.push('---');
  return lines.join('\n');
}

/** CLIs worth probing for. Order controls the order they are advertised in. */
export const REPO_CLIS = ['gh', 'glab', 'git'] as const;

/**
 * Read the repo's remote + branch so the model can resolve "this project" to a
 * concrete repository. Read-only and best-effort: a non-git folder, a repo with
 * no remote, or a missing git binary all yield {}, never an error.
 */
export async function detectGitInfo(
  root: string,
  run?: (cmd: string, cwd?: string) => Promise<{ stdout: string; exit_code: number }>,
): Promise<{ gitRemote?: string; gitBranch?: string }> {
  let runFn = run;
  if (!runFn) {
    try {
      const { runCliOnce } = await import('./tools');
      runFn = (cmd: string, cwd?: string) => runCliOnce(cmd, cwd, 5_000);
    } catch {
      return {};
    }
  }

  const read = async (cmd: string): Promise<string | undefined> => {
    try {
      const r = await runFn!(cmd, root);
      const out = r.stdout.trim();
      return r.exit_code === 0 && out ? out : undefined;
    } catch {
      return undefined;
    }
  };

  const [gitRemote, gitBranch] = await Promise.all([
    read('git remote get-url origin'),
    read('git rev-parse --abbrev-ref HEAD'),
  ]);
  return { gitRemote, gitBranch };
}

/**
 * Detect which repo CLIs exist on PATH via the `probe_binary` Tauri command.
 * Returns [] outside Tauri (browser dev mode) so nothing is advertised that
 * cannot actually be run.
 */
export async function detectRepoClis(
  probe?: (name: string) => Promise<boolean>,
): Promise<string[]> {
  let probeFn = probe;
  if (!probeFn) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      probeFn = (name: string) => invoke<boolean>('probe_binary', { name });
    } catch {
      return [];
    }
  }
  const results = await Promise.all(
    REPO_CLIS.map(async (name): Promise<string | null> => {
      try { return (await probeFn!(name)) ? name : null; }
      catch { return null; }
    }),
  );
  return results.filter((n): n is string => n !== null);
}

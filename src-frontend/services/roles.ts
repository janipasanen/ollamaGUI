/**
 * Agent roles: which model plays which part (organizer, developer, reviewer,
 * writer), and the prompt and tool scope each part gets.
 *
 * A role's model is stored as the same id the model selector uses — a bare
 * name for the local daemon (including Ollama cloud models such as
 * `gpt-oss:120b-cloud`, which the daemon proxies), or `<connectionId>/<name>`
 * for a registered connection (remote Ollama, Ollama Cloud with an API key,
 * LM Studio, vLLM). Routing is resolved at run time, not stored, so a role
 * keeps working when a connection's URL or key changes.
 *
 * An unset role means "use whatever model is currently selected": roles are an
 * opt-in refinement, not a prerequisite for the app to work.
 */

export type Role = 'organizer' | 'developer' | 'reviewer' | 'writer';

export const ROLES: Role[] = ['organizer', 'developer', 'reviewer', 'writer'];

/** Roles the organizer may delegate to. The organizer does not delegate to itself. */
export const DELEGATE_ROLES: Role[] = ['developer', 'reviewer', 'writer'];

export type RoleModels = Partial<Record<Role, string>>;

export const ROLES_STORAGE_KEY = 'agent_roles';

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as string[]).includes(v);
}

export function loadRoleModels(): RoleModels {
  try {
    const raw = JSON.parse(localStorage.getItem(ROLES_STORAGE_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: RoleModels = {};
    for (const r of ROLES) {
      const v = (raw as Record<string, unknown>)[r];
      if (typeof v === 'string' && v.trim()) out[r] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveRoleModels(models: RoleModels): void {
  const clean: RoleModels = {};
  for (const r of ROLES) {
    const v = models[r];
    if (typeof v === 'string' && v.trim()) clean[r] = v;
  }
  try { localStorage.setItem(ROLES_STORAGE_KEY, JSON.stringify(clean)); } catch { /* quota */ }
}

/** True when an organizer is configured, which switches the main run to orchestration. */
export function organizerEnabled(models: RoleModels = loadRoleModels()): boolean {
  return !!models.organizer;
}

/** System prompt per role. Kept short: small local models follow short prompts. */
export const ROLE_PROMPTS: Record<Role, string> = {
  organizer:
    'You are the organizer of a small development team. You do NOT write code or edit files yourself. '
    + 'Break the user\'s goal into steps, record them with update_plan, and delegate each step with '
    + 'delegate_to_role: "developer" implements and runs tests, "reviewer" inspects changes and reports '
    + 'problems, "writer" produces documentation and prose. Give every delegation a self-contained task '
    + '(the role sees none of this conversation). Read the returned result, send fixes back to the '
    + 'developer when the reviewer finds problems, and finish with a short summary of what was done.',
  developer:
    'You are the developer on a team. Implement exactly the task you are given, in the workspace, and run '
    + 'the project\'s tests or checks when they exist. Return a concise report: what you changed (files), '
    + 'and the test result. Do not claim success you have not verified.',
  reviewer:
    'You are the reviewer on a team. Inspect the code and the changes described in your task. You may read '
    + 'and search but you must not modify anything. Return a prioritised list of concrete problems with file '
    + 'and line references, or state clearly that you found none.',
  writer:
    'You are the writer on a team. Produce the documentation, changelog entries or prose you are asked for, '
    + 'accurate to the code. Write files only when asked to. Return the final text or the path you wrote.',
};

const READ_TOOLS = ['read_file', 'list_dir', 'glob_files', 'search_files', 'git_diff', 'git_status'];

/**
 * Tools each role may use. Scoping is the real boundary, not the prompt: a
 * reviewer told "do not modify" but handed write_file will eventually modify.
 * The organizer gets no write or shell tools at all — it can only read, plan
 * and delegate.
 */
export const ROLE_TOOLS: Record<Role, string[]> = {
  organizer: [...READ_TOOLS, 'update_plan', 'delegate_to_role'],
  developer: [...READ_TOOLS, 'write_file', 'apply_edit', 'apply_patch', 'run_shell_command', 'run_tests', 'run_checks'],
  reviewer: [...READ_TOOLS, 'run_tests', 'run_checks'],
  writer: [...READ_TOOLS, 'write_file', 'apply_edit'],
};

/** Intersect a role's tools with those actually registered/enabled. */
export function toolsForRole(role: Role, available: string[]): string[] {
  const set = new Set(available);
  return ROLE_TOOLS[role].filter(t => set.has(t));
}

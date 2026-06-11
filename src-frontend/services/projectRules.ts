/**
 * Project rules file loader (#93).
 *
 * Reads the project rules / instructions file from the workspace root.
 * Recognised filenames (checked in order):
 *   AGENTS.md, agents.md, CLAUDE.md, claude.md, .agents.md, .claude.md
 *
 * The content is injected as the first element of the composed system prompt
 * via `composeSystemPrompt({ rulesFileContent: ... })`.
 */

import { readFile } from './fileTools';

const RULES_FILENAMES = [
  'AGENTS.md',
  'agents.md',
  'CLAUDE.md',
  'claude.md',
  '.agents.md',
  '.claude.md',
];

/** Test seam — override to avoid real Tauri calls. */
export const _mocks = {
  readFile: null as ((path: string) => Promise<string>) | null,
};

async function fsRead(path: string): Promise<string> {
  if (_mocks.readFile) return _mocks.readFile(path);
  return readFile(path);
}

/**
 * Attempt to read a project rules file from `workspaceRoot`.
 * Returns the file content on success, or `null` if no rules file is found.
 */
export async function loadProjectRules(workspaceRoot: string): Promise<string | null> {
  for (const name of RULES_FILENAMES) {
    const path = workspaceRoot.replace(/\/$/, '') + '/' + name;
    try {
      const content = await fsRead(path);
      if (content.trim()) return content;
    } catch {
      // file not found — try next candidate
    }
  }
  return null;
}

/**
 * Format the rules content for display in the system prompt.
 * Trims whitespace and returns as-is (the caller handles the wrapping label).
 */
export function formatRulesContent(content: string): string {
  return content.trim();
}

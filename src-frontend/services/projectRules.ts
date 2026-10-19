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

/**
 * Largest rules file we will inject, in characters (#608).
 *
 * The content goes into the SYSTEM message of every request, so an oversized
 * AGENTS.md silently eats the context window — a real cost that was previously
 * only discoverable by running /tokens and wondering where the budget went.
 * ~16k chars is roughly 4k tokens: generous for genuine instructions, bounded
 * enough that a large or hostile file cannot crowd out the conversation.
 */
export const MAX_RULES_CHARS = 16_000;

/** Test seam — override to avoid real Tauri calls. */
export const _mocks = {
  readFile: null as ((path: string, offset?: number, limit?: number) => Promise<string>) | null,
};

async function fsRead(path: string): Promise<string> {
  if (_mocks.readFile) return _mocks.readFile(path, 0, MAX_RULES_CHARS + 1);
  // Cap at the source rather than after reading: the point is not to pull a
  // 5 MB file across the IPC boundary in the first place.
  return readFile(path, 0, MAX_RULES_CHARS + 1);
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
      if (content.trim()) return capRulesContent(content);
    } catch {
      // file not found — try next candidate
    }
  }
  return null;
}

/**
 * Truncate an oversized rules file and say so in the text itself, so the model
 * knows its instructions were cut rather than silently acting on half of them.
 */
export function capRulesContent(content: string): string {
  if (content.length <= MAX_RULES_CHARS) return content;
  return `${content.slice(0, MAX_RULES_CHARS)}\n\n[Project rules truncated at ${MAX_RULES_CHARS} characters.]`;
}

/**
 * Format the rules content for display in the system prompt.
 * Trims whitespace and returns as-is (the caller handles the wrapping label).
 */
export function formatRulesContent(content: string): string {
  return content.trim();
}

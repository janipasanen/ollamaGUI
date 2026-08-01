/**
 * System prompt composition (#92, #93, #95).
 *
 * Stacks all context sources in a defined order before the base system prompt:
 *   1. Workspace context (project name, working directory, git remote, CLIs)
 *   2. Rules file content (AGENTS.md / CLAUDE.md from workspace root)
 *   3. Project-scoped instructions
 *   4. Persistent memory block
 *   5. Base system prompt
 *
 * The workspace block goes first because it establishes *where* the model is
 * before anything describes how to behave there (#489).
 */

export interface SystemPromptOptions {
  systemPrompt: string;
  /** Rendered workspace block from formatWorkspaceContext() (#489) */
  workspaceBlock?: string;
  /** Contents of AGENTS.md / CLAUDE.md loaded from the workspace root (#93) */
  rulesFileContent?: string;
  /** Project.instructions for the active project (#92) */
  projectInstructions?: string;
  /** Formatted memory block from composeMemoryBlock() (#95) */
  memoryBlock?: string;
}

export function composeSystemPrompt(opts: SystemPromptOptions): string {
  const parts: string[] = [];

  if (opts.workspaceBlock?.trim()) {
    parts.push(opts.workspaceBlock.trim());
  }
  if (opts.rulesFileContent?.trim()) {
    parts.push(`--- Project Rules ---\n${opts.rulesFileContent.trim()}\n---`);
  }
  if (opts.projectInstructions?.trim()) {
    parts.push(`--- Project Instructions ---\n${opts.projectInstructions.trim()}\n---`);
  }
  if (opts.memoryBlock?.trim()) {
    parts.push(opts.memoryBlock.trim());
  }
  parts.push(opts.systemPrompt);

  return parts.join('\n\n');
}

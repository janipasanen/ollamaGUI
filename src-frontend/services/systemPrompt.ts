/**
 * System prompt composition (#92, #93, #95).
 *
 * Stacks all context sources in a defined order before the base system prompt:
 *   1. Rules file content (AGENTS.md / CLAUDE.md from workspace root)
 *   2. Project-scoped instructions
 *   3. Persistent memory block
 *   4. Base system prompt
 */

export interface SystemPromptOptions {
  systemPrompt: string;
  /** Contents of AGENTS.md / CLAUDE.md loaded from the workspace root (#93) */
  rulesFileContent?: string;
  /** Project.instructions for the active project (#92) */
  projectInstructions?: string;
  /** Formatted memory block from composeMemoryBlock() (#95) */
  memoryBlock?: string;
}

export function composeSystemPrompt(opts: SystemPromptOptions): string {
  const parts: string[] = [];

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

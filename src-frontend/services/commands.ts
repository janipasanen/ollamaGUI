/**
 * Slash command registry (#96): built-in and user-defined prompt templates.
 * Commands are typed as /name [arguments] in the chat input.
 * Template commands substitute $ARGUMENTS (or $1, $2, …) before sending.
 */
const STORAGE_KEY = 'ollama_gui_commands';

export interface SlashCommand {
  name: string;          // e.g. 'clear' — without the slash
  description: string;
  /** Raw template; $ARGUMENTS is the full arg string, $1 $2 individual words */
  template?: string;
  /** Built-in runtime function; runs instead of template when defined */
  builtin?: boolean;
}

export interface CommandContext {
  startNewChat: () => void;
  openHelp: () => void;
  sendPrompt: (text: string) => void;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: 'clear', description: 'Start a new chat', builtin: true },
  { name: 'help', description: 'Show keyboard shortcuts and help', builtin: true },
  { name: 'model', description: 'Switch the active model (e.g. /model llama3)', builtin: true },
  { name: 'rename', description: 'Rename the current conversation (e.g. /rename My chat)', builtin: true },
  { name: 'export', description: 'Download the current conversation as a Markdown file', builtin: true },
  { name: 'new', description: 'Start a new chat', builtin: true },
  { name: 'search', description: 'Search conversations (e.g. /search cats)', builtin: true },
  { name: 'copy', description: 'Copy the current conversation as Markdown to the clipboard', builtin: true },
  { name: 'pin', description: 'Pin or unpin the current conversation', builtin: true },
  { name: 'archive', description: 'Archive or unarchive the current conversation', builtin: true },
  { name: 'tag', description: 'Tag the current conversation (e.g. /tag work)', builtin: true },
  { name: 'duplicate', description: 'Duplicate the current conversation', builtin: true },
  { name: 'title', description: 'Regenerate the conversation title from its content', builtin: true },
  { name: 'folder', description: 'Move the current conversation into a folder (e.g. /folder Work)', builtin: true },
  { name: 'system', description: 'Set or view the system prompt (e.g. /system Be concise)', builtin: true },
  { name: 'temp', description: 'Set the temperature (e.g. /temp 0.7)', builtin: true },
  { name: 'ctx', description: 'Set the context window (e.g. /ctx 8192)', builtin: true },
  { name: 'topp', description: 'Set top_p sampling (e.g. /topp 0.9)', builtin: true },
  { name: 'predict', description: 'Set max tokens to generate (e.g. /predict 512; -1 unlimited)', builtin: true },
  { name: 'stop', description: 'Set stop sequences (e.g. /stop <|end|>,\\n\\nUser; clear to reset)', builtin: true },
  { name: 'topk', description: 'Set top_k sampling (e.g. /topk 40)', builtin: true },
  { name: 'cost', description: 'Show token usage and estimated cost for this conversation', builtin: true },
  { name: 'review', description: 'Ask the model to review text or code', template: 'Please review the following and provide feedback:\n\n$ARGUMENTS' },
  { name: 'explain', description: 'Ask the model to explain something', template: 'Please explain the following in plain terms:\n\n$ARGUMENTS' },
  { name: 'summarize', description: 'Summarize the provided text', template: 'Please provide a concise summary of the following:\n\n$ARGUMENTS' },
  { name: 'translate', description: 'Translate text (e.g. /translate to Spanish: hello)', template: 'Translate the following: $ARGUMENTS' },
  { name: 'improve', description: 'Improve or rewrite text', template: 'Please improve the following text for clarity and style:\n\n$ARGUMENTS' },
  { name: 'image', description: 'Generate an image (requires image gen enabled)', template: '/image $ARGUMENTS' },
];

// ── Persistence ───────────────────────────────────────────────────────────────

export function loadUserCommands(): SlashCommand[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
}

export function saveUserCommands(cmds: SlashCommand[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cmds));
}

export function addUserCommand(cmd: Omit<SlashCommand, 'builtin'>): SlashCommand {
  const commands = loadUserCommands();
  const newCmd = { ...cmd, builtin: false as const };
  commands.push(newCmd);
  saveUserCommands(commands);
  return newCmd;
}

export function updateUserCommand(name: string, patch: Partial<SlashCommand>): void {
  const commands = loadUserCommands().map(c => c.name === name ? { ...c, ...patch, builtin: false as const } : c);
  saveUserCommands(commands);
}

export function removeUserCommand(name: string): void {
  saveUserCommands(loadUserCommands().filter(c => c.name !== name));
}

// ── Lookup ────────────────────────────────────────────────────────────────────

export function getAllCommands(): SlashCommand[] {
  return [...BUILTIN_COMMANDS, ...loadUserCommands()];
}

export function filterCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase().replace(/^\//, '');
  if (!q) return getAllCommands();
  return getAllCommands().filter(c => c.name.startsWith(q) || c.description.toLowerCase().includes(q));
}

export function findCommand(name: string): SlashCommand | undefined {
  const n = name.toLowerCase().replace(/^\//, '');
  return getAllCommands().find(c => c.name === n);
}

// ── Execution ─────────────────────────────────────────────────────────────────

/** Expand $ARGUMENTS, $1, $2, … in a template string */
export function expandTemplate(template: string, args: string): string {
  const words = args.trim().split(/\s+/);
  let result = template.replace('$ARGUMENTS', args.trim());
  words.forEach((w, i) => { result = result.replaceAll(`$${i + 1}`, w); });
  return result;
}

export type RunResult =
  | { kind: 'builtin'; action: 'clear' | 'help' | 'model' | 'rename' | 'export' | 'new' | 'search' | 'copy' | 'pin' | 'archive' | 'tag' | 'duplicate' | 'title' | 'folder' | 'system' | 'temp' | 'ctx' | 'topp' | 'predict' | 'stop' | 'topk' | 'cost'; arg?: string }
  | { kind: 'prompt'; text: string }
  | { kind: 'unknown'; input: string }
  | { kind: 'passthrough'; text: string };

/**
 * Parse and execute a slash command string.
 * Returns a RunResult; the caller decides what to do with it.
 */
export function runCommand(input: string): RunResult {
  if (!input.startsWith('/')) return { kind: 'passthrough', text: input };
  const [cmdPart, ...argParts] = input.slice(1).split(' ');
  const args = argParts.join(' ');
  const cmd = findCommand(cmdPart);
  if (!cmd) return { kind: 'unknown', input };
  if (cmd.builtin) {
    if (cmd.name === 'clear') return { kind: 'builtin', action: 'clear' };
    if (cmd.name === 'help') return { kind: 'builtin', action: 'help' };
    if (cmd.name === 'model') return { kind: 'builtin', action: 'model', arg: args };
    if (cmd.name === 'rename') return { kind: 'builtin', action: 'rename', arg: args };
    if (cmd.name === 'export') return { kind: 'builtin', action: 'export' };
    if (cmd.name === 'new') return { kind: 'builtin', action: 'new' };
    if (cmd.name === 'search') return { kind: 'builtin', action: 'search', arg: args };
    if (cmd.name === 'copy') return { kind: 'builtin', action: 'copy' };
    if (cmd.name === 'pin') return { kind: 'builtin', action: 'pin' };
    if (cmd.name === 'archive') return { kind: 'builtin', action: 'archive' };
    if (cmd.name === 'tag') return { kind: 'builtin', action: 'tag', arg: args };
    if (cmd.name === 'duplicate') return { kind: 'builtin', action: 'duplicate' };
    if (cmd.name === 'title') return { kind: 'builtin', action: 'title' };
    if (cmd.name === 'folder') return { kind: 'builtin', action: 'folder', arg: args };
    if (cmd.name === 'system') return { kind: 'builtin', action: 'system', arg: args };
    if (cmd.name === 'temp') return { kind: 'builtin', action: 'temp', arg: args };
    if (cmd.name === 'ctx') return { kind: 'builtin', action: 'ctx', arg: args };
    if (cmd.name === 'topp') return { kind: 'builtin', action: 'topp', arg: args };
    if (cmd.name === 'predict') return { kind: 'builtin', action: 'predict', arg: args };
    if (cmd.name === 'stop') return { kind: 'builtin', action: 'stop', arg: args };
    if (cmd.name === 'topk') return { kind: 'builtin', action: 'topk', arg: args };
    if (cmd.name === 'cost') return { kind: 'builtin', action: 'cost' };
  }
  if (cmd.template) {
    return { kind: 'prompt', text: expandTemplate(cmd.template, args) };
  }
  return { kind: 'unknown', input };
}

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
  | { kind: 'builtin'; action: 'clear' | 'help' }
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
  }
  if (cmd.template) {
    return { kind: 'prompt', text: expandTemplate(cmd.template, args) };
  }
  return { kind: 'unknown', input };
}

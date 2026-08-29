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
  { name: 'connections', description: 'Manage model providers (Ollama, LM Studio)', builtin: true },
  { name: 'model', description: 'Switch the active model (e.g. /model llama3)', builtin: true },
  { name: 'rename', description: 'Rename the current conversation (e.g. /rename My chat)', builtin: true },
  { name: 'export', description: 'Export conversation as Markdown or JSON (e.g. /export json)', builtin: true },
  { name: 'new', description: 'Start a new chat', builtin: true },
  { name: 'search', description: 'Search conversations (e.g. /search cats)', builtin: true },
  { name: 'copy', description: 'Copy the conversation as Markdown or plain text (e.g. /copy txt)', builtin: true },
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
  { name: 'compact', description: 'Summarize the conversation to save context window space', builtin: true },
  { name: 'delete', description: 'Delete the current conversation (with confirmation)', builtin: true },
  { name: 'models', description: 'List all available models', builtin: true },
  { name: 'pull', description: 'Pull a model from Ollama registry (e.g. /pull llama3)', builtin: true },
  { name: 'remove', description: 'Delete a local model (e.g. /remove llama3)', builtin: true },
  { name: 'params', description: 'Show all generation parameters', builtin: true },
  { name: 'stats', description: 'Show conversation statistics (messages, words, tokens)', builtin: true },
  { name: 'id', description: 'Show and copy the current session ID', builtin: true },
  { name: 'merge', description: 'Merge another conversation into this one (e.g. /merge <session-id>)', builtin: true },
  { name: 'undo', description: 'Drop the last user+assistant exchange from this conversation', builtin: true },
  { name: 'redo', description: 'Restore the most recently undone exchange (pairs with /undo)', builtin: true },
  { name: 'diff', description: 'Feed the current git diff into the chat (e.g. /diff staged)', builtin: true },
  { name: 'reset', description: 'Reset generation parameters to defaults (temperature, top-p, top-k, max tokens, stop, context)', builtin: true },
  { name: 'tokens', description: 'Show a per-source context token breakdown', builtin: true },
  { name: 'add', description: 'Pin a file into the chat context across turns (e.g. /add src/main.ts)', builtin: true },
  { name: 'drop', description: 'Remove a pinned file from the chat context (e.g. /drop src/main.ts)', builtin: true },
  { name: 'files', description: 'List files currently pinned into the chat context', builtin: true },
  { name: 'run', description: 'Run a shell command and feed its output into the chat (e.g. /run npm test)', builtin: true },
  { name: 'commit', description: 'Stage all changes and commit (e.g. /commit fix parser); generates a message if omitted', builtin: true },
  { name: 'unstage', description: 'Unstage all currently-staged changes (git reset; keeps working-tree edits)', builtin: true },
  { name: 'tests', description: 'Run a test command and feed failures to the model (e.g. /tests npm test)', builtin: true },
  { name: 'init', description: 'Generate an AGENTS.md project-rules file from the workspace (Aider-style)', builtin: true },
  { name: 'web', description: 'Search the web and feed results into the chat (e.g. /web latest LLM news)', builtin: true },
  { name: 'settings', description: 'Open the settings panel', builtin: true },
  { name: 'prompt', description: 'Preview the full composed system prompt sent to the model', builtin: true },
  { name: 'cwd', description: 'Show and copy the current workspace root path', builtin: true },
  { name: 'map', description: 'Show a workspace repo-map overview (file tree)', builtin: true },
  { name: 'memory', description: 'View the cross-session memory block injected into the prompt', builtin: true },
  { name: 'status', description: 'Show a quick overview (model, workspace, connection, message count)', builtin: true },
  { name: 'save', description: 'Save the current conversation snapshot into the workspace (e.g. /save my-chat)', builtin: true },
  { name: 'load', description: 'Load a conversation snapshot from the workspace (e.g. /load my-chat)', builtin: true },
  { name: 'tools', description: 'List registered agent tools and their enabled/disabled state', builtin: true },
  { name: 'gitundo', description: 'Revert the most recent agent auto-commit (Aider /undo parity)', builtin: true },
  { name: 'warm', description: 'Load a model into memory for faster first response (e.g. /warm llama3:8b)', builtin: true },
  { name: 'unload', description: 'Unload a model from memory to free RAM (e.g. /unload llama3:8b)', builtin: true },
  { name: 'running', description: 'List models currently loaded in Ollama memory', builtin: true },
  { name: 'version', description: 'Show the Ollama server version', builtin: true },
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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cmds)); } catch { /* quota */ }
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

/** Expand $ARGUMENTS, $1, $2, … in a template string.
 *  - Function replacements are used so `$` in the user's arguments (code,
 *    prices, regex, `$&`, `$1`) is inserted literally, not interpreted as
 *    String.replace substitution patterns.
 *  - `$1`…`$N` are substituted BEFORE `$ARGUMENTS` so that `$N` tokens that
 *    appear inside the expanded argument text are not re-substituted (#429). */
export function expandTemplate(template: string, args: string): string {
  const trimmed = args.trim();
  const words = trimmed ? trimmed.split(/\s+/) : [];
  let result = template;
  // Replace `$1`/`$ARGUMENTS` via split/join rather than
  // String.prototype.replaceAll, which is missing on Safari ≤ 13 (macOS 10.15).
  // split/join reproduces replace's global behavior for string search values.
  const replaceAll = (needle: string, value: string) => result.split(needle).join(value);
  words.forEach((w, i) => { result = replaceAll(`$${i + 1}`, w); });
  result = replaceAll('$ARGUMENTS', trimmed);
  return result;
}

export type RunResult =
  | { kind: 'builtin'; action: 'clear' | 'help' | 'model' | 'rename' | 'export' | 'new' | 'search' | 'copy' | 'pin' | 'archive' | 'tag' | 'duplicate' | 'title' | 'folder' | 'system' | 'temp' | 'ctx' | 'topp' | 'predict' | 'stop' | 'topk' | 'cost' | 'compact' | 'delete' | 'models' | 'pull' | 'remove' | 'params' | 'stats' | 'id' | 'merge' | 'undo' | 'redo' | 'diff' | 'reset' | 'tokens' | 'add' | 'drop' | 'files' | 'run' | 'commit' | 'unstage' | 'tests' | 'init' | 'web' | 'settings' | 'prompt' | 'cwd' | 'map' | 'memory' | 'status' | 'save' | 'load' | 'tools' | 'gitundo' | 'warm' | 'unload' | 'running' | 'version' | 'connections'; arg?: string }
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
    if (cmd.name === 'export') return { kind: 'builtin', action: 'export', arg: args };
    if (cmd.name === 'new') return { kind: 'builtin', action: 'new' };
    if (cmd.name === 'search') return { kind: 'builtin', action: 'search', arg: args };
    if (cmd.name === 'copy') return { kind: 'builtin', action: 'copy', arg: args };
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
    if (cmd.name === 'compact') return { kind: 'builtin', action: 'compact' };
    if (cmd.name === 'delete') return { kind: 'builtin', action: 'delete' };
    if (cmd.name === 'models') return { kind: 'builtin', action: 'models' };
    if (cmd.name === 'pull') return { kind: 'builtin', action: 'pull', arg: args };
    if (cmd.name === 'remove') return { kind: 'builtin', action: 'remove', arg: args };
    if (cmd.name === 'params') return { kind: 'builtin', action: 'params' };
    if (cmd.name === 'stats') return { kind: 'builtin', action: 'stats' };
    if (cmd.name === 'id') return { kind: 'builtin', action: 'id' };
    if (cmd.name === 'merge') return { kind: 'builtin', action: 'merge', arg: args };
    if (cmd.name === 'undo') return { kind: 'builtin', action: 'undo' };
    if (cmd.name === 'redo') return { kind: 'builtin', action: 'redo' };
    if (cmd.name === 'diff') return { kind: 'builtin', action: 'diff', arg: args };
    if (cmd.name === 'reset') return { kind: 'builtin', action: 'reset' };
    if (cmd.name === 'tokens') return { kind: 'builtin', action: 'tokens' };
    if (cmd.name === 'add') return { kind: 'builtin', action: 'add', arg: args };
    if (cmd.name === 'drop') return { kind: 'builtin', action: 'drop', arg: args };
    if (cmd.name === 'files') return { kind: 'builtin', action: 'files' };
    if (cmd.name === 'run') return { kind: 'builtin', action: 'run', arg: args };
    if (cmd.name === 'commit') return { kind: 'builtin', action: 'commit', arg: args };
    if (cmd.name === 'unstage') return { kind: 'builtin', action: 'unstage' };
    if (cmd.name === 'tests') return { kind: 'builtin', action: 'tests', arg: args };
    if (cmd.name === 'init') return { kind: 'builtin', action: 'init' };
    if (cmd.name === 'web') return { kind: 'builtin', action: 'web', arg: args };
    if (cmd.name === 'settings') return { kind: 'builtin', action: 'settings' };
    if (cmd.name === 'prompt') return { kind: 'builtin', action: 'prompt' };
    if (cmd.name === 'cwd') return { kind: 'builtin', action: 'cwd' };
    if (cmd.name === 'map') return { kind: 'builtin', action: 'map' };
    if (cmd.name === 'memory') return { kind: 'builtin', action: 'memory' };
    if (cmd.name === 'status') return { kind: 'builtin', action: 'status' };
    if (cmd.name === 'save') return { kind: 'builtin', action: 'save', arg: args };
    if (cmd.name === 'load') return { kind: 'builtin', action: 'load', arg: args };
    if (cmd.name === 'tools') return { kind: 'builtin', action: 'tools' };
    if (cmd.name === 'gitundo') return { kind: 'builtin', action: 'gitundo' };
    if (cmd.name === 'warm') return { kind: 'builtin', action: 'warm', arg: args };
    if (cmd.name === 'unload') return { kind: 'builtin', action: 'unload', arg: args };
    if (cmd.name === 'running') return { kind: 'builtin', action: 'running' };
    if (cmd.name === 'version') return { kind: 'builtin', action: 'version' };
  }
  if (cmd.template) {
    return { kind: 'prompt', text: expandTemplate(cmd.template, args) };
  }
  return { kind: 'unknown', input };
}

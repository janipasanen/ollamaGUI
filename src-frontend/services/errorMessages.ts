/**
 * User-facing error formatting (#30).
 *
 * Translates raw exceptions / API errors into clear, consistent, actionable
 * messages with troubleshooting guidance. Keeps a single place to map common
 * failure modes (connection refused, model missing, timeouts, auth) so the UI
 * surfaces the same friendly text everywhere instead of raw stack messages.
 */

export interface FriendlyError {
  /** Short headline. */
  title: string;
  /** One-line explanation + suggested next step. */
  detail: string;
}

function raw(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

/**
 * Map an error from any layer (fetch, Ollama API, Tauri command) to a friendly
 * title + actionable detail. `context` tunes the guidance (e.g. 'ollama', 'mcp').
 */
export function formatError(err: unknown, context: 'ollama' | 'mcp' | 'cli' | 'generic' = 'generic'): FriendlyError {
  const msg = raw(err);
  const lower = msg.toLowerCase();

  // Network / connection
  if (lower.includes('failed to fetch') || lower.includes('networkerror') ||
      lower.includes('econnrefused') || lower.includes('connection refused') ||
      lower.includes('load failed')) {
    if (context === 'ollama') {
      return {
        title: 'Cannot reach Ollama',
        detail: 'Is Ollama running? Start it with `ollama serve`, then check the base URL in Settings (default http://localhost:11434).',
      };
    }
    if (context === 'mcp') {
      return {
        title: 'Cannot reach MCP server',
        detail: 'Check the server URL and that the server is running, then try connecting again.',
      };
    }
    return { title: 'Connection failed', detail: 'The service could not be reached. Check that it is running and the URL is correct.' };
  }

  // Timeouts
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return {
      title: 'Request timed out',
      detail: context === 'ollama'
        ? 'The model took too long to respond. A smaller model or a larger timeout may help on limited hardware.'
        : 'The operation took too long. Check the connection and try again.',
    };
  }

  // Model not found
  if (lower.includes('model') && (lower.includes('not found') || lower.includes('no such') || lower.includes('try pulling'))) {
    return {
      title: 'Model not available',
      detail: 'That model is not installed. Pull it from the Model Management panel (e.g. `ollama pull llama3`) or pick another model.',
    };
  }

  // Rate limit (from our own limiter)
  if (lower.includes('rate limit') || lower.includes('too many')) {
    return { title: 'Slow down', detail: msg };
  }

  // Auth
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('auth')) {
    return {
      title: 'Authentication required',
      detail: context === 'mcp'
        ? 'This server needs authentication. Use the Auth button to sign in, then reconnect.'
        : 'Authentication failed. Re-enter your credentials and try again.',
    };
  }

  // Service unavailable / 5xx
  if (lower.includes('503') || lower.includes('service unavailable') || lower.includes('502') || lower.includes('500')) {
    return { title: 'Service unavailable', detail: 'The server returned an error. Wait a moment and try again.' };
  }

  // CLI denied
  if (context === 'cli' && (lower.includes('denied') || lower.includes('not allowed') || lower.includes('blocked'))) {
    return { title: 'Command blocked', detail: 'This command is not on the allowlist. Approve it explicitly or adjust the allowed commands.' };
  }

  // Fallback — still cleaner than a bare stack message.
  return { title: 'Something went wrong', detail: msg || 'An unexpected error occurred. Please try again.' };
}

/** Convenience: a single-line string form, e.g. for inline chat error bubbles. */
export function formatErrorLine(err: unknown, context: 'ollama' | 'mcp' | 'cli' | 'generic' = 'generic'): string {
  const { title, detail } = formatError(err, context);
  return `${title} — ${detail}`;
}

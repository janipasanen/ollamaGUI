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
 * title + actionable detail. `context` tunes the guidance (e.g. 'ollama',
 * 'mcp', 'openai-compatible'); `provider` names the user's actual connection so
 * an OpenAI-compatible (LM Studio / vLLM / remote Ollama) host is never told to
 * "start Ollama" (#571/#580).
 */
export function formatError(
  err: unknown,
  context: 'ollama' | 'ollama-cloud' | 'mcp' | 'cli' | 'generic' | 'openai-compatible' = 'generic',
  provider?: { label: string; baseUrl: string },
): FriendlyError {
  const msg = raw(err);
  const lower = msg.toLowerCase();

  // Network / connection
  if (lower.includes('failed to fetch') || lower.includes('networkerror') ||
      lower.includes('econnrefused') || lower.includes('connection refused') ||
      lower.includes('load failed')) {
    // A failed *cloud* request must not tell the user their local daemon is
    // down — it usually is running (#484). Cloud models are proxied by the
    // local daemon, so the real causes are: not signed in, or the model name
    // is no longer offered.
    if (context === 'ollama-cloud') {
      return {
        title: 'Cannot reach Ollama Cloud',
        detail: 'Sign in with `ollama signin`, then check the cloud model name is still available. Cloud models are routed through your local Ollama, so also confirm it is running.',
      };
    }
    if (context === 'ollama') {
      return {
        title: 'Cannot reach Ollama',
        detail: 'Is Ollama running? Start it with `ollama serve`, then press “Test connection” under Settings → Local Ollama Endpoint to verify the URL, or press Retry on this message.',
      };
    }
    if (context === 'mcp') {
      return {
        title: 'Cannot reach MCP server',
        detail: 'Check the server URL and that the server is running, then try connecting again.',
      };
    }
    if (context === 'openai-compatible') {
      // The host is an LM Studio / vLLM / remote connection (not local Ollama),
      // so the "run ollama serve" fix is actively wrong (#571).
      return {
        title: 'Cannot reach ' + (provider?.label ?? 'the model server'),
        detail: 'Nothing answered at ' + (provider?.baseUrl ?? 'the configured endpoint') + '. Check that server is running and reachable, then re-test it in the Providers panel.',
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
    if (context === 'openai-compatible') {
      // A missing model on LM Studio / vLLM isn't pulled from local Ollama —
      // it has to be loaded on that host (issue #571).
      return {
        title: 'Model not available on ' + (provider?.label ?? 'the model server'),
        detail: 'That model is not loaded on ' + (provider?.label ?? 'the server') + '. Load it there and re-test the connection, or pick a model that is available.',
      };
    }
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
export function formatErrorLine(
  err: unknown,
  context: 'ollama' | 'ollama-cloud' | 'mcp' | 'cli' | 'generic' | 'openai-compatible' = 'generic',
  provider?: { label: string; baseUrl: string },
): string {
  const { title, detail } = formatError(err, context, provider);
  return `${title} — ${detail}`;
}

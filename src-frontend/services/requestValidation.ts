/**
 * Request validation + input sanitization (#36, #31).
 *
 * Centralizes validation for the two externally-facing config surfaces that
 * accept free-form user input: MCP server definitions and CLI command strings.
 * Returns structured {valid, error} results so callers can surface actionable
 * messages instead of failing deep in a request.
 */

export interface ValidationResult {
  valid: boolean;
  /** Human-readable reason when invalid (suitable for direct display). */
  error?: string;
}

const OK: ValidationResult = { valid: true };
const fail = (error: string): ValidationResult => ({ valid: false, error });

// ---------------------------------------------------------------------------
// URL validation (#31, #36)
// ---------------------------------------------------------------------------

/**
 * Validate an HTTP(S) endpoint URL. Rejects empty, malformed, and non-http(s)
 * schemes (e.g. file:, javascript:) that could be used for injection.
 */
export function validateHttpUrl(url: string): ValidationResult {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return fail('URL is required.');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return fail('Enter a valid URL, e.g. https://example.com/mcp.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return fail(`Unsupported URL scheme "${parsed.protocol}" — only http and https are allowed.`);
  }
  return OK;
}

// ---------------------------------------------------------------------------
// MCP server config validation (#36)
// ---------------------------------------------------------------------------

export interface McpServerInput {
  name?: string;
  type?: 'stdio' | 'http';
  command?: string;
  url?: string;
}

/** Validate a proposed MCP server definition before it is saved/connected. */
export function validateMcpServer(input: McpServerInput): ValidationResult {
  const name = (input.name ?? '').trim();
  if (!name) return fail('Server name is required.');

  if (input.type === 'http') {
    return validateHttpUrl(input.url ?? '');
  }
  if (input.type === 'stdio') {
    const command = (input.command ?? '').trim();
    if (!command) return fail('Command is required for a stdio server.');
    return validateCliCommand(command);
  }
  return fail('Select a server type (stdio or http).');
}

// ---------------------------------------------------------------------------
// CLI command validation (#36)
// ---------------------------------------------------------------------------

// Shell metacharacters that enable command chaining / injection. We reject them
// in the *command* field; legitimate arguments with these characters should be
// passed as structured args, not embedded in the command string.
const SHELL_INJECTION = /[;&|`$(){}<>\n\r]/;

/**
 * Validate a CLI command string. Empty commands and ones containing shell
 * control/metacharacters are rejected to prevent command chaining/injection.
 */
export function validateCliCommand(command: string): ValidationResult {
  const trimmed = (command ?? '').trim();
  if (!trimmed) return fail('Command cannot be empty.');
  if (SHELL_INJECTION.test(trimmed)) {
    return fail('Command contains shell control characters (; & | ` $ ( ) < >). Pass arguments separately instead.');
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Input sanitization (#36)
// ---------------------------------------------------------------------------

/**
 * Strip C0 control characters (except tab/newline/carriage-return) and DEL,
 * then trim. Use on free-text fields before persistence to keep stored data
 * clean and render-safe. Implemented via char-code filtering to avoid embedding
 * control characters in source.
 */
export function sanitizeText(input: string): string {
  let out = '';
  for (const ch of input ?? '') {
    const code = ch.charCodeAt(0);
    const isC0 = code < 32 && code !== 9 && code !== 10 && code !== 13;
    const isDel = code === 127;
    if (!isC0 && !isDel) out += ch;
  }
  return out.trim();
}

/** True when a chat/submission payload is non-empty after trimming. */
export function isNonEmptySubmission(text: string, attachmentCount = 0): boolean {
  return (text ?? '').trim().length > 0 || attachmentCount > 0;
}

// ---------------------------------------------------------------------------
// Image attachment validation (#31, #59)
// ---------------------------------------------------------------------------

export interface ImageFileLike {
  name: string;
  type: string;
  size: number;
}

export interface ImageValidationResult<T extends ImageFileLike> {
  valid: T[];
  errors: string[];
}

export interface ImageValidationOptions {
  maxImages?: number;
  maxBytes?: number;
  allowed?: string[];
}

/**
 * Validate image attachments: enforce a per-message count cap, an allowlist of
 * MIME types, and a size limit. Returns the accepted files and human-readable
 * errors for the rejected ones.
 */
export function validateImageAttachments<T extends ImageFileLike>(
  files: T[],
  existingCount = 0,
  opts: ImageValidationOptions = {},
): ImageValidationResult<T> {
  const maxImages = opts.maxImages ?? 5;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const allowed = opts.allowed ?? ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  const valid: T[] = [];
  const errors: string[] = [];
  let count = existingCount;

  for (const file of files) {
    if (count >= maxImages) { errors.push(`Max ${maxImages} images per message.`); continue; }
    if (!allowed.includes(file.type)) { errors.push(`${file.name}: unsupported format (use JPEG, PNG, WebP, or GIF).`); continue; }
    if (file.size > maxBytes) { errors.push(`${file.name}: exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit.`); continue; }
    valid.push(file);
    count++;
  }
  return { valid, errors };
}

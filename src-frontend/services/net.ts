/**
 * Timeouts for provider HTTP calls (#663).
 *
 * AGENTS.md requires Ollama interactions to carry timeout handling and tests.
 * The Ollama client honours that (`ollama.ts` builds an AbortController from
 * `timeoutMs`), but every other provider path called `fetch` with no signal at
 * all: image generation, embeddings, compaction, OpenAPI tools and STT all
 * waited until the socket died. A provider that accepts the connection and then
 * stalls — a laptop resuming, a VPN mid-handshake, a wrong port that lands on a
 * tarpit — left the feature spinning with no error and no way back except
 * restarting the app.
 *
 * `timeoutSignal` returns an AbortSignal that fires after `ms`, so the existing
 * error handling in each service turns the abort into its normal failure path
 * instead of hanging.
 */

/** Budgets chosen per operation class: embeddings and spec fetches are quick,
 *  local image generation and whole-conversation summarisation are not. */
export const PROVIDER_TIMEOUTS = {
  /** Embeddings for RAG indexing/search. */
  embeddings: 30_000,
  /** OpenAPI spec download (used while configuring a tool). */
  specFetch: 30_000,
  /** A single OpenAPI/MCP tool call made on the model's behalf. */
  toolCall: 60_000,
  /** Image generation (ComfyUI / OpenAI-compatible endpoints). */
  imageGeneration: 120_000,
  /** Downloading the generated image itself. */
  imageDownload: 60_000,
  /** Conversation compaction — a full transcript goes through the model. */
  compaction: 120_000,
  /** Whisper transcription: audio length dominates, so allow a minute. */
  sttInference: 60_000,
  /** Reachability probe: must fail fast or it blocks the settings UI. */
  sttProbe: 5_000,
  /**
   * Judge checkpoint (#668): one non-streaming turn over a capped transcript.
   * A hung judge must not hold the run hostage — the verdict defaults to
   * `continue` when this expires.
   */
  judge: 60_000,
  /** Browser-mode fallback for the Rust `mcp_http_request` command. */
  mcpRequest: 60_000,
} as const;

/**
 * An AbortSignal that aborts after `ms`.
 *
 * Uses `AbortSignal.timeout` when available and falls back to an
 * AbortController + timer, because jsdom (the test environment) does not always
 * ship the static helper.
 */
export function timeoutSignal(ms: number): AbortSignal {
  const withTimeout = AbortSignal as unknown as {
    timeout?: (milliseconds: number) => AbortSignal;
  };
  if (typeof withTimeout.timeout === 'function') {
    return withTimeout.timeout(ms);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`Timed out after ${ms} ms`, 'TimeoutError'));
  }, ms);
  // Do not keep a Node process alive just for a pending timeout (tests, CLI).
  const unref = (timer as unknown as { unref?: () => void }).unref;
  if (typeof unref === 'function') unref.call(timer);
  // Aborting for any other reason (caller cancellation) should not leave the
  // timer behind.
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller.signal;
}

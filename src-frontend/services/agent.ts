import { Message, GenerationOptions, cleanGenerationOptions, computeGenStats, ollamaErrorFromResponse, type GenStats } from './ollama';
import { toolRegistry, ToolCall, ToolResult, toolCallName, toolCallArgs, truncateToolContent, runToolCalls } from './tools';
import { runPreToolUseHooks, runPostToolUseHooks } from './toolHooks';
import { isBlockedByReadOnlyMode, shouldAskBeforeToolUse } from './agentAutonomy';

export interface AgenticChatOptions {
  model: string;
  messages: Message[];
  maxIterations?: number;
  endpoint?: string;
  /** Abort signal — checked at iteration boundaries so Stop button works in agentic mode. */
  signal?: AbortSignal;
  /** Ollama generation options (num_ctx, temperature, …) applied to every turn. */
  options?: GenerationOptions;
  /** Structured-output constraint (Ollama `format`): 'json' or a JSON Schema object. */
  format?: 'json' | object;
  /**
   * Optional allow-list of tool names. When provided, only these tools are
   * exposed to the model (used for sub-agent scoping, #104).
   */
  toolFilter?: string[];
  /**
   * Plan/ask autonomy gate (#88/#89/#189).
   * Called before each tool execution when shouldAskBeforeToolUse() returns true.
   * Resolves true to allow, false to block.
   */
  onApprovalNeeded?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolResult?: (toolResult: ToolResult) => void;
  onAssistantMessage?: (message: string) => void;
  /** Reasoning/thinking trace accumulator (#245). */
  onAssistantReasoning?: (reasoning: string) => void;
  /** Fired at the start of each loop iteration with (iteration, maxIterations) (#398). */
  onIteration?: (iteration: number, maxIterations: number) => void;
  /** Fired when the loop stops after reaching maxIterations without a final answer (#403). */
  onMaxIterations?: () => void;
  /** Final-turn generation stats (stop reason, tokens) (#391, #392). */
  onGenStats?: (stats: GenStats) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
  /** Fired when the run is cancelled via AbortSignal mid-fetch (#405). Unlike
   *  onError, a cancel is intentional and should not surface an error banner. */
  onCancel?: () => void;
  /**
   * Fired when a transient fetch/stream failure is about to be retried in the
   * agentic loop, with (attemptNumber, maxAttempts). attemptNumber is 1-based
   * — 1 is the first retry. (Issue #586)
   */
  onRetry?: (attempt: number, maxAttempts: number) => void;
}

export async function* agenticChatStream(options: AgenticChatOptions): AsyncGenerator<Message, void, unknown> {
  const {
    model,
    messages,
    maxIterations = 5,
    endpoint = 'http://localhost:11434/api/chat',
    signal,
    options: genOptions,
    format,
    onToolCall,
    onToolResult,
    onAssistantMessage,
    onAssistantReasoning,
    onGenStats,
    onIteration,
    onMaxIterations,
    onComplete,
    onError,
    onCancel,
    onRetry,
    toolFilter,
    onApprovalNeeded,
  } = options;

  // Retry bounds for transient network failures in the agentic loop (#586).
  const MAX_FETCH_RETRIES = 3;

  /**
   * Whether a fetch/stream failure is transient and safe to retry. Network
   * errors (fetch rejections, ECONNRESET/ECONNREFUSED, 502/503/504) qualify;
   * anything else (a 400, a plain Error) does not. A user-initiated abort is
   * never "retryable" here — it is handled separately via the AbortSignal.
   */
  function isRetryableError(error: unknown): boolean {
    if (error instanceof TypeError) return true;
    const err = error as { message?: string; status?: number; code?: string };
    if (typeof err.status === 'number' && [502, 503, 504].includes(err.status)) return true;
    if (
      err.code === 'ECONNRESET' ||
      err.code === 'ECONNREFUSED' ||
      err.code === 'ECONN_CLOSED'
    ) return true;
    const msg = (err.message ?? '').toLowerCase();
    return (
      /network error|networkerror|failed to fetch|load failed|connection (reset|closed|refused)/.test(
        msg
      )
    );
  }

  /** Sleep for `ms`, resolving early with `true` if the signal aborts. */
  function abortableSleep(ms: number, signal?: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (signal?.aborted) {
        resolve(true);
        return;
      }
      const timer = setTimeout(() => resolve(false), ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve(true);
        },
        { once: true }
      );
    });
  }

  /**
   * Stream one Ollama chat turn: fetch the endpoint, parse the NDJSON stream,
   * and accumulate the result into `turn` (`turn.emitted` flips to true on the
   * first content, reasoning, or tool call). Assistant messages are yielded
   * live so callers can surface them. Retrying a transient network failure is
   * the caller's job (#586) — this generator simply surfaces whatever the
   * server returns, and throws on failure.
   */
  async function* streamOllamaTurn(
    endpoint: string,
    requestBody: Record<string, unknown>,
    signal: AbortSignal | undefined,
    turn: {
      message: string;
      reasoning: string;
      toolCalls: ToolCall[];
      hasToolCalls: boolean;
      stats: GenStats | undefined;
      emitted: boolean;
    }
  ): AsyncGenerator<Message> {
    const decoder = new TextDecoder();

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      const statusErr = await ollamaErrorFromResponse(response, 'Ollama API error');
      (statusErr as { status?: number }).status = response.status;
      throw statusErr;
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is null');

    let streamBuf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      streamBuf += decoder.decode(value, { stream: true });
      const lines = streamBuf.split('\n');
      // Keep the last (possibly incomplete) line in the buffer.
      streamBuf = lines.pop() ?? '';
      const completeLines = lines.filter(line => line.trim());

      for (const line of completeLines) {
        try {
          const parsed = JSON.parse(line);

          // Capture reasoning/thinking trace (#245)
          const thinking = parsed.message?.thinking ?? parsed.thinking;
          if (thinking) {
            turn.reasoning += thinking;
            turn.emitted = true;
            if (onAssistantReasoning) {
              onAssistantReasoning(turn.reasoning);
            }
          }
          // Handle regular message content
          if (parsed.message?.content) {
            turn.message += parsed.message.content;
            turn.emitted = true;
            if (onAssistantMessage) {
              onAssistantMessage(turn.message);
            }
            yield {
              role: 'assistant',
              content: turn.message,
              ...(turn.reasoning ? { reasoning: turn.reasoning } : {}),
            } as Message;
          }
          // Capture final-chunk generation stats for this turn (#391, #392).
          if (parsed.done) turn.stats = computeGenStats(parsed);

          // Handle tool calls
          if (parsed.message?.tool_calls) {
            turn.hasToolCalls = true;
            turn.emitted = true;
            for (const toolCall of parsed.message.tool_calls) {
              // Deduplicate across stream chunks. When the model provides a
              // unique `id`, use it. When `id` is missing (common with some
              // Ollama models), fall back to a name+arguments composite key
              // so that DIFFERENT tool calls without ids are not silently
              // dropped as duplicates of the first (#443).
              const dedupKey = toolCall.id
                ?? `__no_id__:${toolCall.function?.name ?? ''}:${toolCall.function?.arguments ?? ''}`;
              const exists = turn.toolCalls.some(tc => {
                const tcKey = tc.id
                  ?? `__no_id__:${tc.function?.name ?? ''}:${tc.function?.arguments ?? ''}`;
                return tcKey === dedupKey;
              });
              if (!exists) {
                turn.toolCalls.push(toolCall);
                if (onToolCall) {
                  onToolCall(toolCall);
                }
              }
            }
          }
        } catch (e) {
          console.error('Error parsing stream chunk', e);
        }
      }
    }

    // Flush any remaining buffered content after the stream ends.
    if (streamBuf.trim()) {
      try {
        const parsed = JSON.parse(streamBuf);
        const thinking = parsed.message?.thinking ?? parsed.thinking;
        if (thinking) {
          turn.reasoning += thinking;
          if (onAssistantReasoning) onAssistantReasoning(turn.reasoning);
        }
        if (parsed.message?.content) {
          turn.message += parsed.message.content;
          turn.emitted = true;
          if (onAssistantMessage) onAssistantMessage(turn.message);
          yield {
            role: 'assistant',
            content: turn.message,
            ...(turn.reasoning ? { reasoning: turn.reasoning } : {}),
          } as Message;
        }
        if (parsed.done) turn.stats = computeGenStats(parsed);
        if (parsed.message?.tool_calls) {
          turn.hasToolCalls = true;
          turn.emitted = true;
          for (const toolCall of parsed.message.tool_calls) {
            const dedupKey = toolCall.id
              ?? `__no_id__:${toolCall.function?.name ?? ''}:${toolCall.function?.arguments ?? ''}`;
            const exists = turn.toolCalls.some(tc => {
              const tcKey = tc.id
                ?? `__no_id__:${tc.function?.name ?? ''}:${tc.function?.arguments ?? ''}`;
              return tcKey === dedupKey;
            });
            if (!exists) {
              turn.toolCalls.push(toolCall);
              if (onToolCall) onToolCall(toolCall);
            }
          }
        }
      } catch (e) {
        console.error('Error parsing stream chunk', e);
      }
    }
  }

  const cleanedOptions = cleanGenerationOptions(genOptions);

  let iteration = 0;
  let hitMaxIterations = false;
  let currentMessages = [...messages];

  while (iteration < maxIterations) {
    // Check abort at the top of every iteration so the Stop button works.
    if (signal?.aborted) break;

    iteration++;

    if (onIteration) onIteration(iteration, maxIterations);

    // Get available tools, filtered by toolFilter if provided (#104)
    const allTools = toolRegistry.getOllamaToolDefinitions();
    const tools = toolFilter ? allTools.filter(t => toolFilter.includes(t.function?.name ?? t.name)) : allTools;

    // Prepare the request
    const requestBody = {
      model,
      messages: currentMessages,
      stream: true,
      ...(tools.length > 0 ? { tools } : {}),
      ...(cleanedOptions ? { options: cleanedOptions } : {}),
      ...(format ? { format } : {}),
    };

    try {
      // Per-turn accumulators populated by streamOllamaTurn.
      const turn = {
        message: '',
        reasoning: '',
        toolCalls: [] as ToolCall[],
        hasToolCalls: false,
        stats: undefined as GenStats | undefined,
        emitted: false,
      };

      // Retry transient fetch/stream failures in place (#586). The fetch+stream
      // is retried before any content is emitted; the retry never consumes an
      // iteration, so a transient 502/503/504 or ECONNRESET still completes the
      // turn. A failure after content was emitted is not replayed.
      let streamError: unknown;
      for (let attempt = 0; !streamError && attempt < MAX_FETCH_RETRIES; attempt++) {
        // Reset per-attempt accumulators.
        turn.message = '';
        turn.reasoning = '';
        turn.toolCalls = [];
        turn.hasToolCalls = false;
        turn.stats = undefined;
        turn.emitted = false;

        try {
          for await (const msg of streamOllamaTurn(endpoint, requestBody, signal, turn)) {
            yield msg;
          }
          break; // stream completed without throwing
        } catch (error) {
          // A user-initiated abort is never retried.
          if (signal?.aborted) {
            streamError = error;
            break;
          }
          // Retry only transient network failures, and only before anything was
          // emitted, so a mid-stream reset never replays a half-built turn.
          if (isRetryableError(error) && !turn.emitted && attempt < MAX_FETCH_RETRIES - 1) {
            if (onRetry) onRetry(attempt + 1, MAX_FETCH_RETRIES);
            if (await abortableSleep(500 * (attempt + 1), signal)) {
              streamError = error;
              break;
            }
            continue;
          }
          streamError = error;
        }
      }

      if (streamError) {
        const errName = (streamError as any)?.name ?? '';
        const errMsg = (streamError as any)?.message ?? '';
        const isAbort = !!signal?.aborted ||
          errName === 'AbortError' || /abort/i.test(errName) || /abort/i.test(errMsg);
        if (isAbort) {
          if (onCancel) onCancel();
          break;
        }
        if (onError) {
          onError(streamError instanceof Error ? streamError : new Error('Unknown error'));
        }
        yield { role: 'assistant', content: `Error: ${streamError instanceof Error ? streamError.message : String(streamError)}` };
        break;
      }

      const assistantMessage = turn.message;
      const assistantReasoning = turn.reasoning;
      const toolCalls = turn.toolCalls;
      const hasToolCalls = turn.hasToolCalls;
      let turnStats: GenStats | undefined = turn.stats;

      // If we have tool calls, execute them and continue the loop
      if (hasToolCalls && toolCalls.length > 0) {
        // Push the assistant's intermediate message (content + tool_calls)
        // into the conversation context so the model can see what it
        // requested when it processes the tool results next iteration (#472).
        currentMessages.push({
          role: 'assistant',
          content: assistantMessage,
          ...(assistantReasoning ? { reasoning: assistantReasoning } : {}),
          tool_calls: toolCalls,
        } as any);
        // Execute the batch, preserving the original tool-call order (#587).
        // Read-only, parallel-safe tools (read_file, list_dir, search_files, …)
        // are grouped and run concurrently; everything else — mutating tools,
        // the approval/pre-hook chains, and gaps between runs — stays strictly
        // sequential and in place. The per-call gate (filter/read-only/
        // approval/pre-hook) and post-hook run one call at a time, so the
        // ordering guarantees are unchanged, and a group is never started once
        // the run aborts (making the batch loop stoppable).
        const toolMessages = await runToolCalls(toolCalls, {
          signal,
          isSafe: (tc) => (toolRegistry.getTool(toolCallName(tc)) as any)?.parallelSafe === true,
          gate: async (tc) => {
            const toolDef = toolRegistry.getTool(toolCallName(tc));
            const toolIsReadOnly = (toolDef as any)?.readOnly ?? false;

            // Per-tool disable (#399/#423): even if the model hallucinates a
            // tool it wasn't offered, a tool excluded from the active toolFilter
            // must not execute. The filter only removes it from the request;
            // enforce it here at execution time too.
            if (toolFilter && !toolFilter.includes(toolCallName(tc))) {
              const blocked: ToolResult = {
                tool_call_id: tc.id ?? 'unknown',
                name: toolCallName(tc),
                content: `Tool blocked: '${toolCallName(tc)}' is disabled by the user.`,
              };
              if (onToolResult) onToolResult(blocked);
              return blocked;
            }

            // Read-only mode check (agentAutonomy #146)
            if (isBlockedByReadOnlyMode(toolIsReadOnly)) {
              const blocked: ToolResult = {
                tool_call_id: tc.id ?? 'unknown',
                name: toolCallName(tc),
                content: `Tool blocked: read-only mode is active and '${toolCallName(tc)}' is not a read-only tool.`,
              };
              if (onToolResult) onToolResult(blocked);
              return blocked;
            }

            // Plan/ask autonomy gate (#88/#89/#189). Read-only (and therefore
            // parallel-safe) tools never prompt at any autonomy level.
            const approvalArgs = toolCallArgs(tc);
            if (shouldAskBeforeToolUse(toolIsReadOnly) && onApprovalNeeded) {
              const approved = await onApprovalNeeded(toolCallName(tc), approvalArgs);
              if (!approved) {
                const blocked: ToolResult = {
                  tool_call_id: tc.id ?? 'unknown',
                  name: toolCallName(tc),
                  content: `Tool blocked: user denied approval (autonomy level: ${(await import('./agentAutonomy')).getAutonomyLevel()}).`,
                };
                if (onToolResult) onToolResult(blocked);
                return blocked;
              }
            }

            // Pre-tool-use hook chain (toolHooks #90)
            const hookResult = await runPreToolUseHooks(toolCallName(tc), approvalArgs);
            if (!hookResult.allowed) {
              const blocked: ToolResult = {
                tool_call_id: tc.id ?? 'unknown',
                name: toolCallName(tc),
                content: `Tool blocked by hook: ${hookResult.reason ?? 'no reason given'}`,
              };
              if (onToolResult) onToolResult(blocked);
              return blocked;
            }
            return null;
          },
          execute: async (tc) => {
            try {
              const toolResult = await toolRegistry.executeToolCall(tc);
              if (onToolResult) {
                onToolResult(toolResult);
              }
              return { result: toolResult, notify: true };
            } catch (error) {
              const errToolName = toolCallName(tc);
              console.error(`Error executing tool ${errToolName}:`, error);
              const result: ToolResult = {
                tool_call_id: tc.id ?? 'unknown',
                name: errToolName,
                content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              };
              return { result, notify: false };
            }
          },
          postProcess: async (tc, result) => {
            // PostToolUse hooks (#395) — may redact/block the output before it
            // reaches the model. The UI still shows the original full result.
            const postHook = await runPostToolUseHooks(result.name, toolCallArgs(tc), result.content);
            // Truncate the model-context copy so a huge output can't blow the
            // context window (#396). UI keeps the full content above.
            return truncateToolContent(postHook.content);
          },
          emit: async (tc, result, storeContent, notify) => {
            if (notify && onToolResult) {
              onToolResult(result);
            }
            currentMessages.push({
              role: 'tool',
              content: storeContent,
              name: result.name,
              tool_call_id: result.tool_call_id,
            } as any);
            return {
              role: 'tool',
              content: result.content,
              name: result.name,
              tool_call_id: result.tool_call_id,
            } as any;
          },
        });

        // Forward batch results to the conversation, in original call order.
        for (const message of toolMessages) {
          yield message as any;
        }

        // Continue to next iteration to let the model respond to tool results
        if (iteration >= maxIterations) {
          hitMaxIterations = true;
        }
        continue;
      }

      // No more tool calls, we're done — surface the final turn's stats.
      if (onGenStats && turnStats) onGenStats(turnStats);
      break;
    } catch (error) {
      // A user-initiated abort (Esc / Stop) during a fetch is NOT an error —
      // surface it via onCancel (#405) so the UI can mark the partial reply
      // as cancelled instead of showing an error banner.
      const errName = (error as any)?.name ?? '';
      const errMsg = (error as any)?.message ?? '';
      const isAbort = !!signal?.aborted ||
        errName === 'AbortError' || /abort/i.test(errName) || /abort/i.test(errMsg);
      if (isAbort) {
        if (onCancel) onCancel();
        break;
      }
      if (onError) {
        onError(error instanceof Error ? error : new Error('Unknown error'));
      }
      yield { role: 'assistant', content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` };
      break;
    }
  }

  if (hitMaxIterations) {
    if (onMaxIterations) onMaxIterations();
    yield {
      role: 'assistant',
      content: `⚠️ Agent stopped: maximum tool iterations (${maxIterations}) reached without a final answer.`,
    } as Message;
  }

  if (onComplete) {
    onComplete();
  }
}

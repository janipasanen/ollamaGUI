import { Message, GenerationOptions, cleanGenerationOptions, translateOpenAiSamplingOptions, openAiResponseFormat, usageToGenStats, type GenStats, type StructuredOutputFormat } from './ollama';
import {
  toolRegistry,
  ToolCall,
  ToolResult,
  toolCallName,
  toolCallArgs,
  truncateToolContent,
  runToolCalls,
} from './tools';
import { runPreToolUseHooks, runPostToolUseHooks } from './toolHooks';
import { isBlockedByReadOnlyMode, shouldAskBeforeToolUse, getAutonomyLevel } from './agentAutonomy';
import { type ModelConnection, normalizeOpenAiHistory } from './connections';

/**
 * Internal tool-call record accumulated from OpenAI SSE deltas. Arguments can
 * arrive in fragments, so we build them up by the call's `index`.
 */
interface AccumulatedToolCall {
  id: string;
  name: string;
  args: string;
}

/** Build an OpenAI chat-completions request for the given connection. */
function buildOpenAiChatRequest(
  conn: ModelConnection,
  model: string,
  messages: any[],
  tools: any[],
  options?: GenerationOptions,
  format?: StructuredOutputFormat,
  stream = true
): { url: string; headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (conn.apiKey) headers['Authorization'] = `Bearer ${conn.apiKey}`;
  // Translate Ollama-style sampling options into OpenAI top-level fields so
  // num_predict/top_p/stop/temperature actually reach the server (#583).
  const sampling = translateOpenAiSamplingOptions(options);
  return {
    url: `${conn.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`,
    headers,
    body: JSON.stringify({
      model,
      messages,
      ...(format ? { response_format: openAiResponseFormat(format) } : {}),
      tools: tools.length > 0 ? tools : undefined,
      stream,
      // Request usage on the final SSE frame for the tokens/sec footer (#575).
      // Only on streaming requests — non-streaming POSTs reject it with a 400.
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...sampling,
    }),
  };
}

/**
 * Stream an OpenAI SSE chat-completions response, yielding incremental
 * { content, reasoning, toolCalls, finishReason } chunks so callers can
 * stream text live while accumulating tool calls (whose arguments arrive
 * spread across multiple deltas).
 */
async function* streamOpenAiWithTools(
  conn: ModelConnection,
  model: string,
  messages: any[],
  tools: any[],
  options?: GenerationOptions,
  format?: StructuredOutputFormat,
  signal?: AbortSignal,
  onGenStats?: (stats: GenStats) => void
): AsyncGenerator<{ content: string; reasoning: string; toolCalls: AccumulatedToolCall[]; finishReason: string | null; streamComplete: boolean }> {
  const { url, headers, body } = buildOpenAiChatRequest(conn, model, messages, tools, options, format, true);
  let res = await fetch(url, { method: 'POST', headers, body, signal });
  // A strict proxy may reject the optional stream_options field; retry once
  // without it so the usage footer never breaks an agentic run (#575).
  if (!res.ok && !signal?.aborted) {
    const { openAiDetailText, stripStreamOptions } = await import('./connections');
    const detail = await openAiDetailText(res);
    if (/stream_options/i.test(detail)) {
      res = await fetch(url, { method: 'POST', headers, body: stripStreamOptions(body), signal });
    }
  }
  if (!res.ok) {
    const { openAiErrorFromResponse } = await import('./connections');
    // Preserve the HTTP status so the transient-failure retry predicate
    // (#586) can classify 502/503/504 even though `openAiErrorFromResponse`
    // only carries the body detail into the Error message.
    const err = await openAiErrorFromResponse(res, 'OpenAI stream error');
    (err as { status?: number }).status = res.status;
    throw err;
  }

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) throw new Error('Response body is null');

  let buf = '';
  let content = '';
  let reasoning = '';
  let finishReason: string | null = null;
  let usage: GenStats | undefined;
  const indexMap = new Map<number, AccumulatedToolCall>();
  const streamStart = Date.now();

  const finalize = (): AccumulatedToolCall[] =>
    [...indexMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, t]) => t);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        yield { content, reasoning, toolCalls: finalize(), finishReason: 'stop', streamComplete: true };
        return;
      }
      try {
        const chunk = JSON.parse(data);
        // include_usage delivers its stats on a trailing {choices:[], usage}
        // frame; surface it so the agentic loop can notify (#575).
        if (chunk?.usage && !usage) {
          usage = usageToGenStats(chunk.usage, finishReason, Date.now() - streamStart);
          if (usage) onGenStats?.(usage);
        }
        const choice = chunk?.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};

        if (delta.content) content += delta.content;
        const r = delta.reasoning_content ?? delta.thinking ?? delta.reasoning;
        if (r) reasoning += r;

        if (choice.finish_reason) finishReason = choice.finish_reason;

        // Accumulate tool-call deltas by index.
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = indexMap.get(idx) ?? {
              id: tc.id ?? `call-${Date.now()}-${idx}`,
              name: '',
              args: '',
            };
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.args += tc.function.arguments;
            indexMap.set(idx, existing);
          }
        }

        // Yield an incremental snapshot so callers can stream text + notify
        // tool calls as they arrive.
        yield { content, reasoning, toolCalls: finalize(), finishReason, streamComplete: false };
      } catch {
        // malformed SSE line — skip
      }
    }
    // Read to stream end so the trailing usage frame (not just the finish
    // content delta) is consumed; finish_reason still drives the consumer.
  }

  // Flush any remaining buffered content.
  if (buf.trim()) {
    if (buf.startsWith('data:')) {
      const data = buf.slice(5).trim();
      if (data !== '[DONE]') {
        try {
          const chunk = JSON.parse(data);
          if (chunk?.usage && !usage) {
            usage = usageToGenStats(chunk.usage, finishReason, Date.now() - streamStart);
            if (usage) onGenStats?.(usage);
          }
          const choice = chunk?.choices?.[0];
          if (choice) {
            const delta = choice.delta ?? {};
            if (delta.content) content += delta.content;
            const r = delta.reasoning_content ?? delta.thinking ?? delta.reasoning;
            if (r) reasoning += r;
            if (choice.finish_reason) finishReason = choice.finish_reason;
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                const existing = indexMap.get(idx) ?? { id: tc.id ?? `call-${Date.now()}-${idx}`, name: '', args: '' };
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) existing.args += tc.function.arguments;
                indexMap.set(idx, existing);
              }
            }
          }
        } catch {
          // ignore
        }
      }
    }
  }

  // Final yield so the caller always observes the fully-accumulated tool
  // calls — and can notify them — even when the reader closed without a
  // trailing buffer (e.g. the final read() returned done with no
  // explicit finish_reason in a separate chunk). streamComplete:true is the
  // authoritative "arguments are now complete" signal.
  yield { content, reasoning, toolCalls: finalize(), finishReason, streamComplete: true };
}

export interface OpenAiAgenticOptions {
  conn: ModelConnection;
  model: string;
  messages: Message[];
  maxIterations?: number;
  signal?: AbortSignal;
  options?: GenerationOptions;
  format?: StructuredOutputFormat;
  toolFilter?: string[];
  onApprovalNeeded?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolResult?: (toolResult: ToolResult) => void;
  onAssistantMessage?: (message: string) => void;
  onAssistantReasoning?: (reasoning: string) => void;
  onIteration?: (iteration: number, maxIterations: number) => void;
  onMaxIterations?: () => void;
  onGenStats?: (stats: GenStats) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
  onCancel?: () => void;
  /**
   * Fired when a transient fetch/stream failure is about to be retried in the
   * agentic loop, with (attemptNumber, maxAttempts). attemptNumber is 1-based.
   * (Issue #586)
   */
  onRetry?: (attempt: number, maxAttempts: number) => void;
}

/**
 * Agentic chat stream for OpenAI-compatible endpoints.
 *
 * Mirrors the behaviour of `agenticChatStream` (agent.ts) but targets
 * OpenAI /v1/chat/completions: it parses OpenAI SSE tool-call deltas, executes
 * tools through the shared tool registry + guardrails, and feeds results back
 * as OpenAI `role:tool` messages carrying `tool_call_id`.
 */
export async function* openAiAgenticChatStream(opts: OpenAiAgenticOptions): AsyncGenerator<Message, void, unknown> {
  const {
    conn,
    model,
    messages,
    maxIterations = 5,
    signal,
    options: genOptions,
    format,
    toolFilter,
    onApprovalNeeded,
    onToolCall,
    onToolResult,
    onAssistantMessage,
    onAssistantReasoning,
    onIteration,
    onMaxIterations,
    onGenStats,
    onComplete,
    onError,
    onCancel,
    onRetry,
  } = opts;

  const cleanedOptions = cleanGenerationOptions(genOptions);

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

  // Convert initial messages to valid OpenAI format. `normalizeOpenAiHistory`
  // coalesces consecutive assistant tool_calls turns, matches every tool
  // message to the nearest preceding unanswered call by `tool_call_id`, drops
  // orphans, and stringifies object args — so a reloaded session replays
  // without the "unmatched tool_call_id" 400 on strict servers (#579).
  let openaiMessages = normalizeOpenAiHistory(messages);

  // Available tools (the registry already emits the OpenAI shape).
  const allTools = toolRegistry.getOllamaToolDefinitions();
  const tools = toolFilter ? allTools.filter(t => toolFilter.includes(t.function?.name ?? t.name)) : allTools;

  let iteration = 0;
  let hitMaxIterations = false;

  // Structured output (response_format) cannot coexist with tool calling —
  // a GBNF/grammar format on every sampled token would block tool_calls
  // entirely. Emit it only when no tools are active; otherwise note it so the
  // user is not silently misled (#583).
  const effectiveFormat = tools.length === 0 ? format : undefined;
  if (format && tools.length > 0 && onAssistantMessage) {
    onAssistantMessage('⚠️ Structured output is inactive for this run because tools are enabled; ignoring schema.');
  }

  while (iteration < maxIterations) {
    if (signal?.aborted) {
      if (onCancel) onCancel();
      break;
    }
    iteration++;
    if (onIteration) onIteration(iteration, maxIterations);

    let assistantContent = '';
    let lastYieldedContent = '';
    let lastYieldedReasoning = '';
    let assistantReasoning = '';
    const toolCalls: ToolCall[] = [];
    const notifiedToolIds = new Set<string>();

    // Retry transient fetch/stream failures in place (#586). The stream is
    // retried before any content is emitted; the retry never consumes an
    // iteration, so a transient 502/503/504 or ECONNRESET still completes the
    // turn. A failure after content was emitted is not replayed.
    let streamError: unknown;
    for (let attempt = 0; !streamError && attempt < MAX_FETCH_RETRIES; attempt++) {
      // Reset per-attempt state so a replayed stream does not accumulate twice.
      assistantContent = '';
      lastYieldedContent = '';
      lastYieldedReasoning = '';
      assistantReasoning = '';
      toolCalls.length = 0;
      notifiedToolIds.clear();
      let emitted = false;

      try {
        for await (
          const { content, reasoning, toolCalls: tcalls, finishReason, streamComplete } of streamOpenAiWithTools(
            conn,
            model,
            openaiMessages,
            tools,
            cleanedOptions,
            effectiveFormat,
            signal,
            onGenStats
          )
        ) {
          assistantContent = content;
          assistantReasoning = reasoning;

          // Stream reasoning to the UI (once reasoning exists).
          if (reasoning !== lastYieldedReasoning) {
            lastYieldedReasoning = reasoning;
            if (reasoning && onAssistantReasoning) {
              onAssistantReasoning(reasoning);
              emitted = true;
            }
          }

          // Stream text to the UI.
          if (content !== lastYieldedContent) {
            lastYieldedContent = content;
            if (content && onAssistantMessage) {
              onAssistantMessage(content);
              emitted = true;
            }
            yield {
              role: 'assistant',
              content: content,
              ...(assistantReasoning ? { reasoning: assistantReasoning } : {}),
            } as Message;
          }

          // Notify each tool call exactly once.
          //
          // Arguments arrive in deltas that come AFTER the tool-call name
          // (streaming argument fragments), so we must not fire `onToolCall`
          // on the first name-only chunk or with partial args. The terminating
          // delta (`finish_reason` set) is only reached once all argument
          // fragments for the tool-call block have been accumulated, so we
          // emit there to guarantee complete arguments.
          for (const tc of tcalls) {
            if (notifiedToolIds.has(tc.id)) continue;
            if (!tc.name || (!finishReason && !streamComplete)) continue;
            notifiedToolIds.add(tc.id);
            const call: ToolCall = {
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: tc.args },
            };
            toolCalls.push(call);
            if (onToolCall) onToolCall(call);
            emitted = true;
          }

          // A stream is complete once the generator has been fully read (the
          // trailing snapshot carries `streamComplete:true`). Breaking on that
          // (instead of on `finishReason` alone) lets the generator drain the
          // final SSE frame so its `usage` can be surfaced via onGenStats (#575).
          if (streamComplete) break;
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
        if (isRetryableError(error) && !emitted && attempt < MAX_FETCH_RETRIES - 1) {
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
      // Surface the failure as a message (parity with the Ollama-native loop,
      // agent.ts) so the caller sees the error even if no onError listener is set.
      yield { role: 'assistant', content: `Error: ${streamError instanceof Error ? streamError.message : String(streamError)}` };
      break;
    }

    const hasToolCalls = toolCalls.length > 0;

    if (hasToolCalls) {
      // Push the assistant intermediate message so the model can see the
      // request before it processes the tool results.
      openaiMessages.push({
        role: 'assistant',
        content: assistantContent,
        ...(assistantReasoning ? { reasoning: assistantReasoning } : {}),
        tool_calls: toolCalls,
      } as any);

      // Execute the batch, preserving tool-call order (#587). Parallel-safe,
      // read-only tools run concurrently; mutating tools, the approval/pre-hook
      // chains, and run gaps stay strictly sequential and in place.
      const toolMessages = await runToolCalls(toolCalls, {
        signal,
        isSafe: (tc) => (toolRegistry.getTool(toolCallName(tc)) as any)?.parallelSafe === true,
        gate: async (tc) => {
          const toolDef = toolRegistry.getTool(toolCallName(tc));
          const toolIsReadOnly = (toolDef as any)?.readOnly ?? false;

          // Enforce toolFilter at execution time.
          if (toolFilter && !toolFilter.includes(toolCallName(tc))) {
            const blocked: ToolResult = {
              tool_call_id: tc.id ?? 'unknown',
              role: 'tool',
              name: toolCallName(tc),
              content: `Tool blocked: '${toolCallName(tc)}' is disabled by the user.`,
            };
            if (onToolResult) onToolResult(blocked);
            return blocked;
          }

          // Read-only mode check.
          if (isBlockedByReadOnlyMode(toolIsReadOnly)) {
            const blocked: ToolResult = {
              tool_call_id: tc.id ?? 'unknown',
              role: 'tool',
              name: toolCallName(tc),
              content: `Tool blocked: read-only mode is active and '${toolCallName(tc)}' is not a read-only tool.`,
            };
            if (onToolResult) onToolResult(blocked);
            return blocked;
          }

          // Plan/ask autonomy gate. Read-only (and therefore parallel-safe)
          // tools never prompt at any autonomy level.
          const approvalArgs = toolCallArgs(tc);
          if (shouldAskBeforeToolUse(toolIsReadOnly) && onApprovalNeeded) {
            const approved = await onApprovalNeeded(toolCallName(tc), approvalArgs);
            if (!approved) {
              const blocked: ToolResult = {
                tool_call_id: tc.id ?? 'unknown',
                role: 'tool',
                name: toolCallName(tc),
                content: `Tool blocked: user denied approval (autonomy level: ${getAutonomyLevel()}).`,
              };
              if (onToolResult) onToolResult(blocked);
              return blocked;
            }
          }

          // Pre-tool-use hook chain.
          const hookResult = await runPreToolUseHooks(toolCallName(tc), approvalArgs);
          if (!hookResult.allowed) {
            const blocked: ToolResult = {
              tool_call_id: tc.id ?? 'unknown',
              role: 'tool',
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
              role: 'tool',
              name: errToolName,
              content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            };
            return { result, notify: false };
          }
        },
        postProcess: async (tc, result) => {
          // PostToolUse hooks — may redact/block the output before it reaches
          // the model. The UI still shows the original full result.
          const postHook = await runPostToolUseHooks(result.name, toolCallArgs(tc), result.content);
          return truncateToolContent(postHook.content);
        },
        emit: async (tc, result, storeContent, notify) => {
          if (notify && onToolResult) {
            onToolResult(result);
          }
          openaiMessages.push({
            role: 'tool',
            tool_call_id: tc.id ?? 'unknown',
            content: storeContent,
            name: result.name,
          });
          return {
            role: 'tool',
            content: result.content,
            name: result.name,
            tool_call_id: tc.id ?? 'unknown',
          } as any;
        },
      });

      // Forward batch results to the conversation, in original call order.
      for (const message of toolMessages) {
        yield message as any;
      }

      if (iteration >= maxIterations) hitMaxIterations = true;
      continue;
    }

    // Final answer (no tool calls).
    break;
  }

  if (hitMaxIterations) {
    if (onMaxIterations) onMaxIterations();
    yield {
      role: 'assistant',
      content: `⚠️ Agent stopped: maximum tool iterations (${maxIterations}) reached without a final answer.`,
    } as Message;
  }

  if (onComplete) onComplete();
}

import { Message, GenerationOptions, cleanGenerationOptions, translateOpenAiSamplingOptions, openAiResponseFormat, type GenStats, type StructuredOutputFormat } from './ollama';
import {
  toolRegistry,
  ToolCall,
  ToolResult,
  toolCallName,
  toolCallArgs,
  truncateToolContent,
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
  signal?: AbortSignal
): AsyncGenerator<{ content: string; reasoning: string; toolCalls: AccumulatedToolCall[]; finishReason: string | null; streamComplete: boolean }> {
  const { url, headers, body } = buildOpenAiChatRequest(conn, model, messages, tools, options, format, true);
  const res = await fetch(url, { method: 'POST', headers, body, signal });
  if (!res.ok) {
    const { openAiErrorFromResponse } = await import('./connections');
    throw await openAiErrorFromResponse(res, 'OpenAI stream error');
  }

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) throw new Error('Response body is null');

  let buf = '';
  let content = '';
  let reasoning = '';
  let finishReason: string | null = null;
  const indexMap = new Map<number, AccumulatedToolCall>();

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
    if (finishReason) break;
  }

  // Flush any remaining buffered content.
  if (buf.trim()) {
    if (buf.startsWith('data:')) {
      const data = buf.slice(5).trim();
      if (data !== '[DONE]') {
        try {
          const chunk = JSON.parse(data);
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
  } = opts;

  const cleanedOptions = cleanGenerationOptions(genOptions);

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

    try {
      for await (
        const { content, reasoning, toolCalls: tcalls, finishReason, streamComplete } of streamOpenAiWithTools(
          conn,
          model,
          openaiMessages,
          tools,
          cleanedOptions,
          effectiveFormat,
          signal
        )
      ) {
        assistantContent = content;
        assistantReasoning = reasoning;

        // Stream reasoning to the UI (once reasoning exists).
        if (reasoning !== lastYieldedReasoning) {
          lastYieldedReasoning = reasoning;
          if (reasoning && onAssistantReasoning) onAssistantReasoning(reasoning);
        }

        // Stream text to the UI.
        if (content !== lastYieldedContent) {
          lastYieldedContent = content;
          if (content && onAssistantMessage) onAssistantMessage(content);
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
        }

        // A stream is complete when it either ends with a tool_calls finish
        // reason, or when the reader has closed (DONE) with no finish reason.
        if (finishReason === 'tool_calls' || finishReason === 'stop') break;
      }
    } catch (error) {
      // A connection or stream error surfaces via onError (parity with the
      // Ollama-native agentic loop in agent.ts).
      if (onError) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
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

      for (const toolCall of toolCalls) {
        try {
          const toolDef = toolRegistry.getTool(toolCallName(toolCall));
          const toolIsReadOnly = (toolDef as any)?.readOnly ?? false;

          // Enforce toolFilter at execution time.
          if (toolFilter && !toolFilter.includes(toolCallName(toolCall))) {
            const blocked: ToolResult = {
              tool_call_id: toolCall.id ?? 'unknown',
              role: 'tool',
              name: toolCallName(toolCall),
              content: `Tool blocked: '${toolCallName(toolCall)}' is disabled by the user.`,
            };
            if (onToolResult) onToolResult(blocked);
            openaiMessages.push({ role: 'tool', tool_call_id: toolCall.id ?? 'unknown', content: blocked.content, name: blocked.name });
            yield { role: 'tool', content: blocked.content, name: blocked.name, tool_call_id: toolCall.id ?? 'unknown' } as any;
            continue;
          }

          // Read-only mode check.
          if (isBlockedByReadOnlyMode(toolIsReadOnly)) {
            const blocked: ToolResult = {
              tool_call_id: toolCall.id ?? 'unknown',
              role: 'tool',
              name: toolCallName(toolCall),
              content: `Tool blocked: read-only mode is active and '${toolCallName(toolCall)}' is not a read-only tool.`,
            };
            if (onToolResult) onToolResult(blocked);
            openaiMessages.push({ role: 'tool', tool_call_id: toolCall.id ?? 'unknown', content: blocked.content, name: blocked.name });
            yield { role: 'tool', content: blocked.content, name: blocked.name, tool_call_id: toolCall.id ?? 'unknown' } as any;
            continue;
          }

          // Plan/ask autonomy gate.
          const approvalArgs = toolCallArgs(toolCall);
          if (shouldAskBeforeToolUse(toolIsReadOnly) && onApprovalNeeded) {
            const approved = await onApprovalNeeded(toolCallName(toolCall), approvalArgs);
            if (!approved) {
              const blocked: ToolResult = {
                tool_call_id: toolCall.id ?? 'unknown',
                role: 'tool',
                name: toolCallName(toolCall),
                content: `Tool blocked: user denied approval (autonomy level: ${getAutonomyLevel()}).`,
              };
              if (onToolResult) onToolResult(blocked);
              openaiMessages.push({ role: 'tool', tool_call_id: toolCall.id ?? 'unknown', content: blocked.content, name: blocked.name });
              yield { role: 'tool', content: blocked.content, name: blocked.name, tool_call_id: toolCall.id ?? 'unknown' } as any;
              continue;
            }
          }

          // Pre-tool-use hook chain.
          const hookArgs = approvalArgs;
          const hookResult = await runPreToolUseHooks(toolCallName(toolCall), hookArgs);
          if (!hookResult.allowed) {
            const blocked: ToolResult = {
              tool_call_id: toolCall.id ?? 'unknown',
              role: 'tool',
              name: toolCallName(toolCall),
              content: `Tool blocked by hook: ${hookResult.reason ?? 'no reason given'}`,
            };
            if (onToolResult) onToolResult(blocked);
            openaiMessages.push({ role: 'tool', tool_call_id: toolCall.id ?? 'unknown', content: blocked.content, name: blocked.name });
            yield { role: 'tool', content: blocked.content, name: blocked.name, tool_call_id: toolCall.id ?? 'unknown' } as any;
            continue;
          }

          const toolResult = await toolRegistry.executeToolCall(toolCall);
          if (onToolResult) onToolResult(toolResult);

          // PostToolUse hooks.
          const postHook = await runPostToolUseHooks(toolResult.name, approvalArgs, toolResult.content);
          const modelContent = truncateToolContent(postHook.content);

          openaiMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id ?? 'unknown',
            content: modelContent,
            name: toolResult.name,
          });

          yield {
            role: 'tool',
            content: toolResult.content,
            name: toolResult.name,
            tool_call_id: toolResult.tool_call_id,
          } as any;
        } catch (error) {
          const errToolName = toolCallName(toolCall);
          console.error(`Error executing tool ${errToolName}:`, error);
          const errResult: ToolResult = {
            tool_call_id: toolCall.id ?? 'unknown',
            role: 'tool',
            name: errToolName,
            content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };
          if (onToolResult) onToolResult(errResult);
          openaiMessages.push({ role: 'tool', tool_call_id: toolCall.id ?? 'unknown', content: errResult.content, name: errResult.name });
          yield { role: 'tool', content: errResult.content, name: errResult.name, tool_call_id: errResult.tool_call_id } as any;
        }
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

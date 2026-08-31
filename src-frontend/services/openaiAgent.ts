// Agentic tool-calling loop for OpenAI-compatible endpoints (LM Studio,
// llama.cpp server, vLLM, …) — #551.
//
// The Ollama loop in agent.ts speaks Ollama's /api/chat protocol; pointing it
// at LM Studio silently broke tool calling for Qwen coder models (the exact
// gap that makes opencode work where naive clients fail). This loop speaks
// the OpenAI chat-completions dialect those servers implement:
//   - `tools` in the {type:"function",function:{…}} schema on every request
//   - streamed tool calls arrive as index-keyed FRAGMENTS in
//     choices[0].delta.tool_calls (id/name once, arguments as many string
//     slices) that must be accumulated until finish_reason === "tool_calls"
//   - tool results return as {role:"tool", tool_call_id, content}
//   - Qwen models may emit reasoning inline as <think>…</think> in content
//     (instead of the reasoning_content field) — filtered into the reasoning
//     channel, split-tag-safe across chunk boundaries
//
// The tool-execution sequence (filter → read-only → approval → hooks →
// execute → post-hooks → truncate) deliberately mirrors agent.ts step for
// step so autonomy semantics are identical on both protocols.

import { Message } from './ollama';
import { ModelConnection, openAiErrorFromResponse, deltaReasoning } from './connections';
import { toolRegistry, ToolCall, ToolResult, toolCallName, toolCallArgs, truncateToolContent } from './tools';
import { runPreToolUseHooks, runPostToolUseHooks } from './toolHooks';
import { isBlockedByReadOnlyMode, shouldAskBeforeToolUse, getAutonomyLevel } from './agentAutonomy';
import { shouldCompact, compactConversation } from './compaction';
import { parseQwenToolCalls, makeQwenStreamFilter } from './qwenDialect';

// Re-exported so the OpenAI-agent module stays the single import site for
// callers that only care about the agent loop.
export { makeQwenStreamFilter, makeThinkFilter, type QwenStreamFilter } from './qwenDialect';

export interface OpenAiAgenticOptions {
  conn: Pick<ModelConnection, 'baseUrl' | 'apiKey'>;
  model: string;
  messages: Message[];
  maxIterations?: number;
  signal?: AbortSignal;
  temperature?: number;
  toolFilter?: string[];
  compactThresholdTokens?: number;
  onApprovalNeeded?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolResult?: (toolResult: ToolResult) => void;
  onAssistantMessage?: (message: string) => void;
  onAssistantReasoning?: (reasoning: string) => void;
  onIteration?: (iteration: number, maxIterations: number) => void;
  onMaxIterations?: () => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
  onCancel?: () => void;
}

/** One tool call being assembled from streamed fragments, keyed by index. */
interface PendingToolCall {
  id?: string;
  name: string;
  argsJson: string;
}

/** True when `text` parses as a JSON object — the shape tool arguments take. */
function isParsableJsonObject(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/** Map our transcript to OpenAI chat-completions messages. */
export function toOpenAiMessages(messages: Message[]): any[] {
  return messages.map(m => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: (m as any).tool_call_id ?? m.name ?? 'call_0',
        content: m.content,
      };
    }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: 'assistant',
        // OpenAI requires string-or-null content on tool-call turns.
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc: any, i: number) => ({
          id: tc.id ?? `call_${i}`,
          type: 'function',
          function: {
            name: toolCallName(tc),
            arguments: typeof tc.function?.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function?.arguments ?? tc.arguments ?? {}),
          },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

/** Summarizer over the same OpenAI endpoint, for in-loop compaction. */
function makeOpenAiSummarizeFn(conn: Pick<ModelConnection, 'baseUrl' | 'apiKey'>, model: string) {
  return async (messages: Message[]): Promise<string> => {
    const transcript = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    const res = await fetch(`${conn.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Summarise the following conversation concisely in 3–5 bullet points, preserving key facts and decisions. Output only the summary.' },
          { role: 'user', content: transcript },
        ],
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`Summarize failed: HTTP ${res.status}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
  };
}

export async function* openaiAgenticChatStream(options: OpenAiAgenticOptions): AsyncGenerator<Message, void, unknown> {
  const {
    conn, model, messages,
    maxIterations = 5,
    signal, temperature, toolFilter, compactThresholdTokens,
    onApprovalNeeded, onToolCall, onToolResult,
    onAssistantMessage, onAssistantReasoning,
    onIteration, onMaxIterations, onComplete, onError, onCancel,
  } = options;

  const endpoint = `${conn.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {}),
  };

  let iteration = 0;
  let hitMaxIterations = false;
  let currentMessages: Message[] = [...messages];
  // Monotonic fallback id for providers that omit tool-call ids in deltas.
  let syntheticCallId = 0;

  while (iteration < maxIterations) {
    if (signal?.aborted) break;
    iteration++;
    if (onIteration) onIteration(iteration, maxIterations);

    // In-loop compaction (#549 rank 13), summarised over the same endpoint.
    if (compactThresholdTokens && shouldCompact(currentMessages, compactThresholdTokens)) {
      try {
        currentMessages = await compactConversation(currentMessages, {
          thresholdTokens: compactThresholdTokens,
          summarizeFn: makeOpenAiSummarizeFn(conn, model),
        });
      } catch { /* best-effort — never kill the run over compaction */ }
    }

    const allTools = toolRegistry.getOllamaToolDefinitions();
    const tools = toolFilter ? allTools.filter(t => toolFilter.includes(t.function?.name ?? t.name)) : allTools;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: toOpenAiMessages(currentMessages),
          stream: true,
          ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
          ...(temperature != null ? { temperature } : {}),
        }),
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) throw await openAiErrorFromResponse(res, 'OpenAI-compatible agent error');

      const reader = res.body?.getReader();
      if (!reader) throw new Error('Response body is null');
      const decoder = new TextDecoder();

      let assistantContent = '';
      let assistantReasoning = '';
      let finishReason: string | null = null;
      const pending = new Map<number, PendingToolCall>();
      const streamFilter = makeQwenStreamFilter();
      const emit = (part: { content: string; reasoning: string }) => {
        if (part.reasoning) {
          assistantReasoning += part.reasoning;
          if (onAssistantReasoning) onAssistantReasoning(assistantReasoning);
        }
        if (part.content) {
          assistantContent += part.content;
          if (onAssistantMessage) onAssistantMessage(assistantContent);
        }
      };

      const consumeChunk = (data: string) => {
        const chunk = JSON.parse(data);
        const choice = chunk?.choices?.[0];
        if (!choice) return;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const d = choice.delta ?? {};
        // Reasoning: dedicated field first, <think> tags in content second.
        // deltaReasoning() covers vLLM's `reasoning` alongside the more common
        // `reasoning_content`/`thinking` — see its docstring.
        const fieldReasoning = deltaReasoning(d);
        if (fieldReasoning) {
          assistantReasoning += fieldReasoning;
          if (onAssistantReasoning) onAssistantReasoning(assistantReasoning);
        }
        if (typeof d.content === 'string' && d.content.length > 0) {
          emit(streamFilter.push(d.content));
        }
        // Tool-call fragments: accumulate by index (spec-shaped streaming).
        // LM Studio sends `tool_calls: []` on ordinary chat turns and can send
        // fragments carrying nothing at all; either would otherwise mint a
        // nameless call the loop then tries to execute forever
        // (opencode#4255). Only fragments with real payload create an entry.
        if (Array.isArray(d.tool_calls)) {
          for (const frag of d.tool_calls) {
            const hasPayload = !!frag?.id || !!frag?.function?.name ||
              typeof frag?.function?.arguments === 'string';
            if (!hasPayload) continue;
            const idx = typeof frag.index === 'number' ? frag.index : 0;
            const p = pending.get(idx) ?? { name: '', argsJson: '' };
            if (frag.id) p.id = frag.id;
            if (frag.function?.name) p.name += frag.function.name;
            if (typeof frag.function?.arguments === 'string') p.argsJson += frag.function.arguments;
            pending.set(idx, p);
          }
        }
      };

      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') { buf = ''; break; }
          try { consumeChunk(data); } catch { /* malformed SSE frame — skip */ }
        }
      }
      // Flush a trailing frame without a newline (#466 parity).
      const tail = buf.trim();
      if (tail.startsWith('data:')) {
        const data = tail.slice(5).trim();
        if (data && data !== '[DONE]') { try { consumeChunk(data); } catch { /* skip */ } }
      }

      // Release anything the tag filter was holding back for a partial tag.
      emit(streamFilter.flush());

      const toolCalls: ToolCall[] = [...pending.entries()]
        .sort(([a], [b]) => a - b)
        // A fragment stream that never carried a function name cannot be
        // executed — drop it instead of dispatching a call to "".
        .filter(([, p]) => p.name.trim().length > 0)
        .map(([, p]) => ({
          id: p.id ?? `call_synth_${syntheticCallId++}`,
          type: 'function',
          // Keep arguments as the raw JSON string (OpenAI convention);
          // toolCallArgs() parses it tolerantly at execution/display time.
          function: { name: p.name, arguments: p.argsJson || '{}' },
        } as any));

      // Fallback: Qwen3-Coder on LM Studio puts its calls in the content
      // channel as XML. Recover them only when the server produced none
      // natively, so a compliant server is never second-guessed.
      if (toolCalls.length === 0) {
        const raw = streamFilter.toolCallText();
        if (raw) {
          const { calls, cleanedContent } = parseQwenToolCalls(raw, tools, `qwen_${iteration}`);
          toolCalls.push(...calls);
          // Blocks we could not parse (or that named an unknown tool) come
          // back as text — appended, since the surrounding prose already
          // streamed. Better visible than silently swallowed.
          if (cleanedContent.trim()) {
            assistantContent += cleanedContent;
            if (onAssistantMessage) onAssistantMessage(assistantContent);
          }
        }
      }

      if (toolCalls.length === 0) {
        // Final answer — no tools requested this turn.
        const final: Message = {
          role: 'assistant',
          content: assistantContent,
          ...(assistantReasoning ? { reasoning: assistantReasoning } : {}),
        };
        if (onAssistantMessage) onAssistantMessage(assistantContent);
        yield final;
        if (onComplete) onComplete();
        return;
      }

      // Record the assistant tool-call turn, then run each call through the
      // same gate sequence as agent.ts (kept in step — see module comment).
      const assistantTurn: Message = {
        role: 'assistant',
        content: assistantContent,
        tool_calls: toolCalls,
        ...(assistantReasoning ? { reasoning: assistantReasoning } : {}),
      };
      currentMessages.push(assistantTurn);

      for (const toolCall of toolCalls) {
        if (signal?.aborted) break;
        if (onToolCall) onToolCall(toolCall);
        const name = toolCallName(toolCall);
        const callId = (toolCall as any).id as string;
        const pushToolMsg = (content: string): Message => {
          const msg = { role: 'tool', content, name, tool_call_id: callId } as Message;
          currentMessages.push(msg);
          return msg;
        };

        const toolDef = toolRegistry.getAllTools().find(t => t.name === name);
        const toolIsReadOnly = (toolDef as any)?.readOnly ?? false;

        // Local builds truncate or malform argument JSON often enough to
        // matter — llama.cpp will happily stop mid-object at the token limit.
        // toolCallArgs() falls back to {} on a parse error, which would run
        // the tool with no arguments and hand the model a baffling result;
        // naming the real problem lets it simply re-emit the call.
        const rawArgs = (toolCall as any).function?.arguments;
        if (typeof rawArgs === 'string' && rawArgs.trim() && !isParsableJsonObject(rawArgs)) {
          const bad: ToolResult = {
            name,
            content: `Error: could not parse the arguments for '${name}' as JSON. Re-issue the call with valid JSON arguments. Received: ${rawArgs.slice(0, 200)}`,
          };
          if (onToolResult) onToolResult(bad);
          yield pushToolMsg(bad.content);
          continue;
        }

        if (toolFilter && !toolFilter.includes(name)) {
          const blocked: ToolResult = { name, content: `Tool blocked: '${name}' is disabled by the user.` };
          if (onToolResult) onToolResult(blocked);
          yield pushToolMsg(blocked.content);
          continue;
        }
        if (isBlockedByReadOnlyMode(toolIsReadOnly)) {
          const blocked: ToolResult = { name, content: `Tool blocked: read-only mode is active and '${name}' is not a read-only tool.` };
          if (onToolResult) onToolResult(blocked);
          yield pushToolMsg(blocked.content);
          continue;
        }
        const approvalArgs = toolCallArgs(toolCall);
        if (shouldAskBeforeToolUse(toolIsReadOnly) && onApprovalNeeded) {
          const approved = await onApprovalNeeded(name, approvalArgs);
          if (!approved) {
            const blocked: ToolResult = { name, content: `Tool blocked: user denied approval (autonomy level: ${getAutonomyLevel()}).` };
            if (onToolResult) onToolResult(blocked);
            yield pushToolMsg(blocked.content);
            continue;
          }
        }
        const hookResult = await runPreToolUseHooks(name, approvalArgs);
        if (!hookResult.allowed) {
          const blocked: ToolResult = { name, content: `Tool blocked by hook: ${hookResult.reason ?? 'denied'}` };
          if (onToolResult) onToolResult(blocked);
          yield pushToolMsg(blocked.content);
          continue;
        }
        try {
          const toolResult = await toolRegistry.executeToolCall(toolCall);
          const postHook = await runPostToolUseHooks(toolResult.name, approvalArgs, toolResult.content);
          const modelContent = truncateToolContent(postHook.content);
          if (onToolResult) onToolResult({ ...toolResult, content: postHook.content });
          yield pushToolMsg(modelContent);
        } catch (error) {
          // A hallucinated tool name or a throwing tool must not kill the run
          // (agent.ts parity): feed the error back so the model can correct
          // itself. Local Qwen builds get names wrong often enough that
          // aborting here reads to the user as "the model is broken".
          const detail = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Error executing tool ${name}:`, error);
          if (onToolResult) onToolResult({ name, content: `Error: ${detail}` });
          yield pushToolMsg(`Error: ${detail}`);
        }
      }
      // Next iteration sends the tool results back to the model.
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        if (onCancel) onCancel();
        return;
      }
      if (onError) onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }
  }

  if (iteration >= maxIterations) {
    hitMaxIterations = true;
    if (onMaxIterations) onMaxIterations();
    yield {
      role: 'assistant',
      // The prefix is load-bearing (the "Continue agent" button keys off it).
      content: `⚠️ Agent stopped: maximum tool iterations (${maxIterations}) reached without a final answer. It paused before finishing — use "Continue agent" below to let it keep going.`,
    };
  }
  if (onComplete && !hitMaxIterations) onComplete();
  if (onComplete && hitMaxIterations) onComplete();
}

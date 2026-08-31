import { Message, GenerationOptions, cleanGenerationOptions, computeGenStats, ollamaErrorFromResponse, type GenStats } from './ollama';
import { toolRegistry, ToolCall, ToolResult, toolCallName, toolCallArgs } from './tools';
import { runPreToolUseHooks, runPostToolUseHooks } from './toolHooks';
import { isBlockedByReadOnlyMode, shouldAskBeforeToolUse } from './agentAutonomy';
import { truncateToolContent } from './tools';
import { shouldCompact, compactConversation, makeSummarizeFn } from './compaction';

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
   * Compact the transcript INSIDE the loop when it grows past this many
   * estimated tokens (#549 audit rank 13). Overflow happens during the
   * iterations, not before them — a pre-send-only compaction never fired
   * where it mattered. Omit to disable (service tests, sub-agents).
   */
  compactThresholdTokens?: number;
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
    toolFilter,
    onApprovalNeeded,
    compactThresholdTokens,
  } = options;

  const cleanedOptions = cleanGenerationOptions(genOptions);

  let iteration = 0;
  let hitMaxIterations = false;
  let currentMessages = [...messages];

  while (iteration < maxIterations) {
    // Check abort at the top of every iteration so the Stop button works.
    if (signal?.aborted) break;

    iteration++;

    if (onIteration) onIteration(iteration, maxIterations);

    // In-loop compaction (#549 rank 13): tool output accumulates ACROSS
    // iterations, so the window fills mid-run. Summarize the oldest turns
    // before the next request rather than letting Ollama truncate silently
    // (which evicts the system prompt and the user's goal first).
    if (compactThresholdTokens && shouldCompact(currentMessages, compactThresholdTokens)) {
      try {
        currentMessages = await compactConversation(currentMessages, {
          thresholdTokens: compactThresholdTokens,
          summarizeFn: makeSummarizeFn(model, endpoint),
        });
      } catch { /* compaction is best-effort — never kill the run over it */ }
    }

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
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        ...(signal ? { signal } : {}),
      });
      
      if (!response.ok) {
        throw await ollamaErrorFromResponse(response, 'Ollama API error');
      }
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) {
        throw new Error('Response body is null');
      }
      
      let assistantMessage = '';
      let assistantReasoning = '';
      let toolCalls: ToolCall[] = [];
      let hasToolCalls = false;
      let turnStats: GenStats | undefined;
      
      // Process the stream — buffer incomplete lines across chunks (#444).
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
              assistantReasoning += thinking;
              if (onAssistantReasoning) {
                onAssistantReasoning(assistantReasoning);
              }
            }
            // Handle regular message content
            if (parsed.message?.content) {
              assistantMessage += parsed.message.content;
              if (onAssistantMessage) {
                onAssistantMessage(assistantMessage);
              }
              yield { role: 'assistant', content: assistantMessage, ...(assistantReasoning ? { reasoning: assistantReasoning } : {}) } as Message;
            }
            
            // Capture final-chunk generation stats for this turn (#391, #392).
            if (parsed.done) turnStats = computeGenStats(parsed);

            // Handle tool calls
            if (parsed.message?.tool_calls) {
              hasToolCalls = true;
              for (const toolCall of parsed.message.tool_calls) {
                // Deduplicate across stream chunks. When the model provides a
                // unique `id`, use it. When `id` is missing (common with some
                // Ollama models), fall back to a name+arguments composite key
                // so that DIFFERENT tool calls without ids are not silently
                // dropped as duplicates of the first (#443).
                // Serialise the arguments rather than interpolating them:
                // Ollama sends `arguments` as an OBJECT, and `${{}}` is
                // "[object Object]" for every call, so two different calls to
                // the same tool in one turn collapsed to one and the second
                // was silently dropped — the exact failure #443 set out to
                // prevent, reintroduced for the shape Ollama actually sends.
                const argKey = (a: unknown) =>
                  typeof a === 'string' ? a : JSON.stringify(a ?? '');
                const dedupKey = toolCall.id
                  ?? `__no_id__:${toolCall.function?.name ?? ''}:${argKey(toolCall.function?.arguments)}`;
                const exists = toolCalls.some(tc => {
                  const tcKey = tc.id
                    ?? `__no_id__:${tc.function?.name ?? ''}:${argKey(tc.function?.arguments)}`;
                  return tcKey === dedupKey;
                });
                if (!exists) {
                  toolCalls.push(toolCall);
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
            assistantReasoning += thinking;
            if (onAssistantReasoning) onAssistantReasoning(assistantReasoning);
          }
          if (parsed.message?.content) {
            assistantMessage += parsed.message.content;
            if (onAssistantMessage) onAssistantMessage(assistantMessage);
            yield { role: 'assistant', content: assistantMessage, ...(assistantReasoning ? { reasoning: assistantReasoning } : {}) } as Message;
          }
          if (parsed.done) turnStats = computeGenStats(parsed);
          if (parsed.message?.tool_calls) {
            hasToolCalls = true;
            for (const toolCall of parsed.message.tool_calls) {
              const dedupKey = toolCall.id
                ?? `__no_id__:${toolCall.function?.name ?? ''}:${toolCall.function?.arguments ?? ''}`;
              const exists = toolCalls.some(tc => {
                const tcKey = tc.id
                  ?? `__no_id__:${tc.function?.name ?? ''}:${tc.function?.arguments ?? ''}`;
                return tcKey === dedupKey;
              });
              if (!exists) {
                toolCalls.push(toolCall);
                if (onToolCall) onToolCall(toolCall);
              }
            }
          }
        } catch { /* ignore trailing partial */ }
      }

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
        for (const toolCall of toolCalls) {
          // Stop means stop, mid-batch (#577). Without this, a turn that
          // queued several tools ran every one of them to completion after
          // the user pressed Stop — under 'auto' autonomy nothing gates them,
          // so files kept being written and shell commands kept firing while
          // the UI said the run had stopped. Checked before onToolCall so a
          // skipped call never appears as "called" in the activity panel.
          // The OpenAI loop has always done this; this is the parity fix.
          if (signal?.aborted) break;
          try {
            const toolDef = toolRegistry.getTool(toolCallName(toolCall));
            const toolIsReadOnly = (toolDef as any)?.readOnly ?? false;

            // Per-tool disable (#399/#423): even if the model hallucinates a
            // tool it wasn't offered, a tool excluded from the active toolFilter
            // must not execute. The filter only removes it from the request;
            // enforce it here at execution time too.
            if (toolFilter && !toolFilter.includes(toolCallName(toolCall))) {
              const blocked: ToolResult = {
                name: toolCallName(toolCall),
                content: `Tool blocked: '${toolCallName(toolCall)}' is disabled by the user.`,
              };
              if (onToolResult) onToolResult(blocked);
              currentMessages.push({ role: 'tool', content: blocked.content, name: blocked.name } as any);
              yield { role: 'tool', content: blocked.content, name: blocked.name } as any;
              continue;
            }

            // Read-only mode check (agentAutonomy #146)
            if (isBlockedByReadOnlyMode(toolIsReadOnly)) {
              const blocked: ToolResult = {
                name: toolCallName(toolCall),
                content: `Tool blocked: read-only mode is active and '${toolCallName(toolCall)}' is not a read-only tool.`,
              };
              if (onToolResult) onToolResult(blocked);
              currentMessages.push({ role: 'tool', content: blocked.content, name: blocked.name } as any);
              yield { role: 'tool', content: blocked.content, name: blocked.name } as any;
              continue;
            }

            // Plan/ask autonomy gate (#88/#89/#189)
            const approvalArgs = toolCallArgs(toolCall);
            if (shouldAskBeforeToolUse(toolIsReadOnly) && onApprovalNeeded) {
              const approved = await onApprovalNeeded(toolCallName(toolCall), approvalArgs);
              if (!approved) {
                const blocked: ToolResult = {
                  name: toolCallName(toolCall),
                  content: `Tool blocked: user denied approval (autonomy level: ${(await import('./agentAutonomy')).getAutonomyLevel()}).`,
                };
                if (onToolResult) onToolResult(blocked);
                currentMessages.push({ role: 'tool', content: blocked.content, name: blocked.name } as any);
                yield { role: 'tool', content: blocked.content, name: blocked.name } as any;
                continue;
              }
            }

            // Pre-tool-use hook chain (toolHooks #90)
            const hookArgs = approvalArgs;
            const hookResult = await runPreToolUseHooks(toolCallName(toolCall), hookArgs);
            if (!hookResult.allowed) {
              const blocked: ToolResult = {
                name: toolCallName(toolCall),
                content: `Tool blocked by hook: ${hookResult.reason ?? 'no reason given'}`,
              };
              if (onToolResult) onToolResult(blocked);
              currentMessages.push({ role: 'tool', content: blocked.content, name: blocked.name } as any);
              yield { role: 'tool', content: blocked.content, name: blocked.name } as any;
              continue;
            }

            const toolResult = await toolRegistry.executeToolCall(toolCall);
            if (onToolResult) {
              onToolResult(toolResult);
            }
            
            // PostToolUse hooks (#395) — may redact/block the output before it
            // reaches the model. The UI still shows the original full result.
            const postHook = await runPostToolUseHooks(toolResult.name, approvalArgs, toolResult.content);
            // Truncate the model-context copy so a huge output can't blow the
            // context window (#396). UI keeps the full content above.
            const modelContent = truncateToolContent(postHook.content);

            // Add tool result to messages for next iteration (model context)
            currentMessages.push({
              role: 'tool',
              content: modelContent,
              name: toolResult.name,
            } as any);
            
            yield {
              role: 'tool',
              content: toolResult.content,
              name: toolResult.name,
            } as any;
          } catch (error) {
            const errToolName = toolCallName(toolCall);
            console.error(`Error executing tool ${errToolName}:`, error);
            currentMessages.push({
              role: 'tool',
              content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              name: errToolName,
            } as any);

            yield {
              role: 'tool',
              content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              name: errToolName,
            } as any;
          }
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
      // The prefix is load-bearing (the "Continue agent" button keys off it);
      // the second sentence is the plain-language part (#549 rank 9).
      content: `⚠️ Agent stopped: maximum tool iterations (${maxIterations}) reached without a final answer. It paused before finishing — use "Continue agent" below to let it keep working.`,
    } as Message;
  }

  if (onComplete) {
    onComplete();
  }
}

import { Message, GenerationOptions, cleanGenerationOptions } from './ollama';
import { toolRegistry, ToolCall, ToolResult } from './tools';
import { runPreToolUseHooks } from './toolHooks';
import { isBlockedByReadOnlyMode } from './agentAutonomy';

export interface AgenticChatOptions {
  model: string;
  messages: Message[];
  maxIterations?: number;
  endpoint?: string;
  /** Ollama generation options (num_ctx, temperature, …) applied to every turn. */
  options?: GenerationOptions;
  /** Structured-output constraint (Ollama `format`): 'json' or a JSON Schema object. */
  format?: 'json' | object;
  /**
   * Optional allow-list of tool names. When provided, only these tools are
   * exposed to the model (used for sub-agent scoping, #104).
   */
  toolFilter?: string[];
  onToolCall?: (toolCall: ToolCall) => void;
  onToolResult?: (toolResult: ToolResult) => void;
  onAssistantMessage?: (message: string) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

export async function* agenticChatStream(options: AgenticChatOptions): AsyncGenerator<Message, void, unknown> {
  const {
    model,
    messages,
    maxIterations = 5,
    endpoint = 'http://localhost:11434/api/chat',
    options: genOptions,
    format,
    onToolCall,
    onToolResult,
    onAssistantMessage,
    onComplete,
    onError,
    toolFilter,
  } = options;

  const cleanedOptions = cleanGenerationOptions(genOptions);

  let iteration = 0;
  let hitMaxIterations = false;
  let currentMessages = [...messages];

  while (iteration < maxIterations) {
    iteration++;

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
      });
      
      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) {
        throw new Error('Response body is null');
      }
      
      let assistantMessage = '';
      let toolCalls: ToolCall[] = [];
      let hasToolCalls = false;
      
      // Process the stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            
            // Handle regular message content
            if (parsed.message?.content) {
              assistantMessage += parsed.message.content;
              if (onAssistantMessage) {
                onAssistantMessage(assistantMessage);
              }
              yield { role: 'assistant', content: assistantMessage } as Message;
            }
            
            // Handle tool calls
            if (parsed.message?.tool_calls) {
              hasToolCalls = true;
              for (const toolCall of parsed.message.tool_calls) {
                if (!toolCalls.some(tc => tc.id === toolCall.id)) {
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
      
      // If we have tool calls, execute them and continue the loop
      if (hasToolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          try {
            const toolDef = toolRegistry.getTool(toolCall.function?.name ?? toolCall.name);
            const toolIsReadOnly = (toolDef as any)?.readOnly ?? false;

            // Read-only mode check (agentAutonomy #146)
            if (isBlockedByReadOnlyMode(toolIsReadOnly)) {
              const blocked: ToolResult = {
                name: toolCall.function?.name ?? toolCall.name,
                content: `Tool blocked: read-only mode is active and '${toolCall.function?.name ?? toolCall.name}' is not a read-only tool.`,
              };
              if (onToolResult) onToolResult(blocked);
              currentMessages.push({ role: 'tool', content: blocked.content, name: blocked.name } as any);
              yield { role: 'tool', content: blocked.content, name: blocked.name } as any;
              continue;
            }

            // Pre-tool-use hook chain (toolHooks #90)
            const hookArgs = (toolCall.function?.arguments ?? {}) as Record<string, unknown>;
            const hookResult = await runPreToolUseHooks(toolCall.function?.name ?? toolCall.name, hookArgs);
            if (!hookResult.allowed) {
              const blocked: ToolResult = {
                name: toolCall.function?.name ?? toolCall.name,
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
            
            // Add tool result to messages for next iteration
            currentMessages.push({
              role: 'tool',
              content: toolResult.content,
              name: toolResult.name,
            } as any);
            
            yield {
              role: 'tool',
              content: toolResult.content,
              name: toolResult.name,
            } as any;
          } catch (error) {
            console.error(`Error executing tool ${toolCall.function.name}:`, error);
            currentMessages.push({
              role: 'tool',
              content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              name: toolCall.function.name,
            } as any);
            
            yield {
              role: 'tool',
              content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              name: toolCall.function.name,
            } as any;
          }
        }
        
        // Continue to next iteration to let the model respond to tool results
        if (iteration >= maxIterations) {
          hitMaxIterations = true;
        }
        continue;
      }

      // No more tool calls, we're done
      break;
    } catch (error) {
      if (onError) {
        onError(error instanceof Error ? error : new Error('Unknown error'));
      }
      yield { role: 'assistant', content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` };
      break;
    }
  }

  if (hitMaxIterations) {
    yield {
      role: 'assistant',
      content: `⚠️ Agent stopped: maximum tool iterations (${maxIterations}) reached without a final answer.`,
    } as Message;
  }

  if (onComplete) {
    onComplete();
  }
}
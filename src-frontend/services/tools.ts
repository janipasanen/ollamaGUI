export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, {
      type: string;
      description: string;
    }>;
    required?: string[];
  };
  execute: (params: Record<string, any>) => Promise<any>;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  role: 'tool';
  name: string;
  content: string;
}

class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  
  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }
  
  unregisterTool(name: string): void {
    this.tools.delete(name);
  }
  
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
  
  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }
  
  getOllamaToolDefinitions(): any[] {
    return this.getAllTools().map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
  
  async executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.getTool(toolCall.function.name);
    if (!tool) {
      throw new Error(`Tool ${toolCall.function.name} not found`);
    }
    
    const params = JSON.parse(toolCall.function.arguments);
    const result = await tool.execute(params);
    
    return {
      tool_call_id: toolCall.id,
      role: 'tool',
      name: toolCall.function.name,
      content: JSON.stringify(result),
    };
  }
}

export const toolRegistry = new ToolRegistry();

// Built-in tools
export function registerBuiltInTools() {
  // System information tool
  toolRegistry.registerTool({
    name: 'get_system_info',
    description: 'Get basic system information',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async () => ({
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      language: navigator.language,
      timestamp: new Date().toISOString(),
    }),
  });
  
  // Time tool
  toolRegistry.registerTool({
    name: 'get_current_time',
    description: 'Get the current time in ISO format',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async () => ({
      time: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });
  
  // Calculator tool
  toolRegistry.registerTool({
    name: 'calculate',
    description: 'Perform a mathematical calculation',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The mathematical expression to evaluate',
        },
      },
      required: ['expression'],
    },
    execute: async (params: { expression: string }) => {
      try {
        // Note: In a real app, you'd want to sanitize this input
        const result = eval(params.expression); // eslint-disable-line no-eval
        return { result };
      } catch (error) {
        return { error: 'Invalid expression' };
      }
    },
  });
  
  // Text processing tool
  toolRegistry.registerTool({
    name: 'text_process',
    description: 'Process text (uppercase, lowercase, reverse, etc.)',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text to process',
        },
        operation: {
          type: 'string',
          description: 'The operation to perform (uppercase, lowercase, reverse, length)',
          enum: ['uppercase', 'lowercase', 'reverse', 'length'],
        },
      },
      required: ['text', 'operation'],
    },
    execute: async (params: { text: string; operation: string }) => {
      switch (params.operation) {
        case 'uppercase':
          return { result: params.text.toUpperCase() };
        case 'lowercase':
          return { result: params.text.toLowerCase() };
        case 'reverse':
          return { result: params.text.split('').reverse().join('') };
        case 'length':
          return { result: params.text.length };
        default:
          return { error: 'Unknown operation' };
      }
    },
  });
}
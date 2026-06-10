import { describe, it, expect, vi } from 'vitest';
import { toolRegistry } from '../services/tools';

describe('Simple Agentic Tests', () => {
  it('should have working tool registry', () => {
    const testTool = {
      name: 'test_tool',
      description: 'A test tool',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input parameter' },
        },
      },
      execute: async (params: any) => ({ result: `Processed: ${params.input}` }),
    };

    toolRegistry.registerTool(testTool);
    const retrievedTool = toolRegistry.getTool('test_tool');

    expect(retrievedTool).toBeDefined();
    expect(retrievedTool?.name).toBe('test_tool');
  });

  it('should execute tools correctly', async () => {
    const testTool = {
      name: 'test_tool',
      description: 'A test tool',
      parameters: {
        type: 'object',
        properties: {
          multiply: { type: 'number', description: 'Multiplier' },
        },
      },
      execute: async (params: any) => ({ result: params.multiply * 2 }),
    };

    toolRegistry.registerTool(testTool);

    const toolCall = {
      id: 'test-123',
      type: 'function',
      function: {
        name: 'test_tool',
        arguments: JSON.stringify({ multiply: 5 }),
      },
    };

    const result = await toolRegistry.executeToolCall(toolCall);

    expect(result).toEqual({
      tool_call_id: 'test-123',
      role: 'tool',
      name: 'test_tool',
      content: '{"result":10}',
    });
  });
});
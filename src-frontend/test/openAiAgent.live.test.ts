import { describe, it, expect, beforeEach } from 'vitest';
import { openAiAgenticChatStream } from '../services/openAiAgent';
import { toolRegistry } from '../services/tools';
import { setAutonomyLevel } from '../services/agentAutonomy';
import type { ModelConnection } from '../services/connections';

/**
 * LIVE integration smoke test.
 *
 * Exercises `openAiAgenticChatStream` against a real OpenAI-compatible
 * switchyard (default http://172.16.222.168:4000) to prove the agent loop
 * parses a live tool-calling stream, executes tools, and feeds results back.
 *
 * It is skipped unless OPENAI_LIVE=1 so it never fails CI on machines without
 * the remote, but it is run locally to verify real end-to-end behaviour.
 *
 * Runs in the `node` environment: jsdom's fetch returns null `Response.body`,
 * so SSE streaming would never parse under the default DOM environment.
 *
 * @vitest-environment node
 */
const baseUrl = process.env.OPENAI_LIVE_BASE ?? 'http://172.16.222.168:4000';
const model = process.env.OPENAI_LIVE_MODEL ?? 'switchyard/ornith35';

const conn: ModelConnection = {
  id: 'live',
  name: 'live',
  kind: 'openai',
  baseUrl,
  enabled: true,
};

const run = (opts: Parameters<typeof openAiAgenticChatStream>[0]) => (async () => {
  const gen = openAiAgenticChatStream(opts);
  for await (const _ of gen) {
    // discard
  }
})();

describe('OPENAI_LIVE: openAiAgenticChatStream against real switchyard', () => {
  beforeEach(() => {
    setAutonomyLevel('auto');
    toolRegistry.registerTool({
      name: 'add_numbers',
      description: 'Add two integers and return the sum.',
      parameters: {
        type: 'object',
        properties: {
          a: { type: 'integer', description: 'First addend' },
          b: { type: 'integer', description: 'Second addend' },
        },
        required: ['a', 'b'],
      },
      async execute(params: Record<string, unknown>) {
        const a = Number(params.a);
        const b = Number(params.b);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return { error: 'non-numeric argument' };
        return { sum: a + b };
      },
    });
  });

  it.skipIf(!process.env.OPENAI_LIVE)('calls a tool on the live model, executes it, and completes', async () => {
    const toolCalls: string[] = [];
    const toolResults: string[] = [];
    const toolCallArgs: Record<string, unknown>[] = [];
    const contents: string[] = [];

    await run({
      conn,
      model,
      messages: [{ role: 'user', content: 'Compute and call add_numbers with a=7 and b=8.' }],
      maxIterations: 4,
      onToolCall: (tc) => {
        toolCalls.push(`${tc.function?.name}`);
        if (typeof tc.function?.arguments === 'string') {
          try { toolCallArgs.push(JSON.parse(tc.function.arguments)); } catch { toolCallArgs.push({ raw: tc.function.arguments }); }
        }
      },
      onToolResult: (r) => toolResults.push(`${r.name}:${r.content}`),
      onAssistantMessage: (m) => { if (m.trim()) contents.push(m); },
      onError: (e) => { throw e; },
    });

    // The live model must have requested our tool.
    expect(toolCalls.some((t) => t.startsWith('add_numbers'))).toBe(true);
    // The tool call must have carried *complete* arguments (this is the fix
    // under verification: streaming argument fragments were previously
    // notifying the loop before they had arrived, yielding empty args).
    const addCall = toolCallArgs.find(a => a && a.a !== undefined && a.b !== undefined);
    expect(addCall).toEqual({ a: 7, b: 8 });
    // The result must have executed and fed back.
    expect(toolResults.some((t) => t.startsWith('add_numbers:') && t.includes('"sum":15'))).toBe(true);
    // A final assistant message must have been produced.
    expect(contents.some((m) => /\*\*?15\*\*/.test(m) || /15/.test(m))).toBe(true);
  }, 60_000);
});

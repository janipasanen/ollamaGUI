// @vitest-environment node
/**
 * Opt-in live agentic round-trip against real local model servers (#551).
 *
 * Skipped unless LIVE_QWEN=1, because it needs servers this repo does not
 * provision and a 35B model can take several minutes per turn — it must never
 * run in CI or in a plain `npm test`.
 *
 *   LIVE_QWEN=1 npx vitest run src-frontend/test/liveQwenAgent.test.ts
 *
 * Override the defaults with LIVE_LMSTUDIO_URL / LIVE_LMSTUDIO_MODEL and
 * LIVE_OLLAMA_URL / LIVE_OLLAMA_MODEL.
 *
 * What it proves that the mocked specs cannot: that the fixtures in
 * openaiAgent.test.ts still match what the server actually sends, and that a
 * Qwen coder model completes a multi-tool agentic run through our loop —
 * plan, inspect, answer — rather than stalling after the first tool.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openaiAgenticChatStream } from '../services/openaiAgent';
import { agenticChatStream } from '../services/agent';
import { toolRegistry } from '../services/tools';

const LIVE = process.env.LIVE_QWEN === '1';
const LMSTUDIO_URL = process.env.LIVE_LMSTUDIO_URL ?? 'http://172.16.222.168:1234';
const LMSTUDIO_MODEL = process.env.LIVE_LMSTUDIO_MODEL ?? 'qwen/qwen3-coder-next';
const OLLAMA_URL = process.env.LIVE_OLLAMA_URL ?? 'http://172.16.222.168:11434';
const OLLAMA_MODEL = process.env.LIVE_OLLAMA_MODEL ?? 'janimpasanen/ornith-codex-256k';

// A 35B model on a shared GPU regularly needs minutes for a single turn.
const TIMEOUT = 900_000;

const FILES: Record<string, string> = {
  'src/main.rs': 'fn main() { println!("hi"); }\n',
  'src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n',
};

const TOOL_NAMES = ['list_dir', 'read_file', 'update_plan'];

beforeAll(() => {
  toolRegistry.registerTool({
    name: 'list_dir', description: 'List files and directories at a path', readOnly: true,
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path' } }, required: ['path'] },
    execute: async ({ path }: any) => ({ entries: Object.keys(FILES).filter(f => f.startsWith(String(path))) }),
  });
  toolRegistry.registerTool({
    name: 'read_file', description: 'Read the full contents of a file', readOnly: true,
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path' } }, required: ['path'] },
    execute: async ({ path }: any) => ({ path, content: FILES[String(path)] ?? null }),
  });
  // Nested array-of-objects schema — the shape local tool parsers most often
  // mangle, and the one the app's real update_plan tool uses.
  toolRegistry.registerTool({
    name: 'update_plan', description: 'Record or update the plan for the current task', readOnly: false,
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array', description: 'Ordered plan steps',
          items: {
            type: 'object',
            properties: { step: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } },
            required: ['step', 'status'],
          },
        },
      },
      required: ['steps'],
    },
    execute: async ({ steps }: any) => ({ recorded: Array.isArray(steps) ? steps.length : 0 }),
  });
});

afterAll(() => TOOL_NAMES.forEach(n => toolRegistry.unregisterTool(n)));

const PROMPT =
  'Plan your work with update_plan (2-3 steps), then call list_dir on "src" and ' +
  'read_file on src/lib.rs, and finally state in one sentence what the add function does.';

/** Drive a run to completion and collect what the UI would have seen. */
async function collect(gen: AsyncGenerator<any>, sink: { calls: string[]; final: string }) {
  for await (const _m of gen) { /* callbacks capture everything we assert on */ }
  return sink;
}

describe.skipIf(!LIVE)('LIVE — Qwen agentic round-trip (#551)', () => {
  it('LM Studio: plans, inspects, and answers through the OpenAI loop', async () => {
    const sink = { calls: [] as string[], final: '' };
    const errors: string[] = [];
    await collect(openaiAgenticChatStream({
      conn: { baseUrl: LMSTUDIO_URL },
      model: LMSTUDIO_MODEL,
      messages: [{ role: 'user', content: PROMPT }],
      maxIterations: 8,
      toolFilter: TOOL_NAMES,
      onToolCall: tc => sink.calls.push(tc.function?.name ?? ''),
      onAssistantMessage: m => { sink.final = m; },
      onError: e => errors.push(e.message),
    }), sink);

    expect(errors).toEqual([]);
    // The nested-schema tool and the file reads all had to survive the wire.
    expect(sink.calls).toContain('update_plan');
    expect(sink.calls).toContain('list_dir');
    expect(sink.calls).toContain('read_file');
    // It reached a real answer, not a max-iterations stop.
    expect(sink.final).not.toMatch(/^⚠️ Agent stopped/);
    expect(sink.final.toLowerCase()).toMatch(/add|sum|integer/);
    // Markup must never reach the chat bubble.
    expect(sink.final).not.toContain('<tool_call>');
    expect(sink.final).not.toContain('<think>');
  }, TIMEOUT);

  it('Ollama: same run through the /api/chat loop', async () => {
    const sink = { calls: [] as string[], final: '' };
    const errors: string[] = [];
    await collect(agenticChatStream({
      model: OLLAMA_MODEL,
      endpoint: `${OLLAMA_URL}/api/chat`,
      messages: [{ role: 'user', content: PROMPT }],
      maxIterations: 8,
      toolFilter: TOOL_NAMES,
      onToolCall: tc => sink.calls.push(tc.function?.name ?? ''),
      onAssistantMessage: m => { sink.final = m; },
      onError: e => errors.push(e.message),
    }), sink);

    expect(errors).toEqual([]);
    expect(sink.calls).toContain('list_dir');
    expect(sink.calls).toContain('read_file');
    expect(sink.final).not.toMatch(/^⚠️ Agent stopped/);
    expect(sink.final.toLowerCase()).toMatch(/add|sum|integer/);
  }, TIMEOUT);
});

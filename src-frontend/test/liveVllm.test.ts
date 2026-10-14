// @vitest-environment node
/**
 * Opt-in live check against a real vLLM server (#552).
 *
 * Skipped unless LIVE_VLLM=1 — it needs a server this repo does not provision,
 * so it must never run in CI or in a plain `npm test`.
 *
 *   LIVE_VLLM=1 npx vitest run src-frontend/test/liveVllm.test.ts
 *
 * Override with LIVE_VLLM_URL / LIVE_VLLM_MODEL (the model defaults to
 * whatever /v1/models lists first, so usually only the URL is needed).
 *
 * What it proves that the mocked specs cannot: that a real vLLM build lists
 * its models where we look, streams reasoning in the field we now read, and
 * completes an agentic tool round-trip through our OpenAI loop.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fetchAllConnectionModels, streamOpenAiChat, type ModelConnection } from '../services/connections';
import { openaiAgenticChatStream } from '../services/openaiAgent';
import { toolRegistry } from '../services/tools';

const LIVE = process.env.LIVE_VLLM === '1';
const URL_ = process.env.LIVE_VLLM_URL ?? 'http://gx10:8000';
const MODEL_OVERRIDE = process.env.LIVE_VLLM_MODEL;

// A 35B model on a shared GPU can need minutes for a single turn.
const TIMEOUT = 900_000;

const CONN: ModelConnection = { id: 'live-vllm', name: 'gx10', kind: 'vllm', baseUrl: URL_, enabled: true };

const FILES: Record<string, string> = {
  'src/main.rs': 'fn main() { println!("hi"); }\n',
  'src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n',
};

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
});

afterAll(() => ['list_dir', 'read_file'].forEach(n => toolRegistry.unregisterTool(n)));

describe.skipIf(!LIVE)('LIVE — vLLM provider (#552)', () => {
  let model = MODEL_OVERRIDE ?? '';

  it('lists the served models through the provider dispatch', async () => {
    const models = await fetchAllConnectionModels([CONN]);
    expect(models.length).toBeGreaterThan(0);
    // Every entry must be tagged back to this provider, or the selector
    // cannot group it and routing cannot find its connection.
    expect(models.every(m => m.connectionId === CONN.id && m.kind === 'vllm')).toBe(true);
    expect(models[0].id).toBe(`${CONN.id}/${models[0].name}`);
    if (!model) model = models[0].name;
  }, TIMEOUT);

  it('streams an answer, keeping reasoning off the chat channel', async () => {
    const deltas: string[] = [];
    const reasons: string[] = [];
    await streamOpenAiChat(CONN, model, [{ role: 'user', content: 'Reply with exactly: HELLO' }],
      (d, r) => { if (d) deltas.push(d); if (r) reasons.push(r); });

    const content = deltas.join('');
    expect(content.toUpperCase()).toContain('HELLO');
    // Whatever the model thinks must never reach the visible text.
    expect(content).not.toContain('<think>');
    // This model reasons before answering, and vLLM streams that in the
    // `reasoning` delta field. Unread — which is what shipped before #552 —
    // every reasoning token was dropped and this array stayed empty, so a
    // non-empty reasoning channel is the actual regression signal here.
    expect(reasons.join('').length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('completes an agentic tool round-trip', async () => {
    const calls: string[] = [];
    const errors: string[] = [];
    let final = '';
    const gen = openaiAgenticChatStream({
      conn: CONN,
      model,
      messages: [{ role: 'user', content: 'Call list_dir on "src", then read_file on src/lib.rs, then say in one sentence what the add function does.' }],
      maxIterations: 8,
      toolFilter: ['list_dir', 'read_file'],
      onToolCall: tc => calls.push(tc.function?.name ?? ''),
      onAssistantMessage: m => { final = m; },
      onError: e => errors.push(e.message),
    });
    for await (const _m of gen) { /* callbacks capture what we assert on */ }

    expect(errors).toEqual([]);
    expect(calls).toContain('list_dir');
    expect(calls).toContain('read_file');
    expect(final).not.toMatch(/^⚠️ Agent stopped/);
    expect(final.toLowerCase()).toMatch(/add|sum|integer/);
    // Markup must never reach the chat bubble.
    expect(final).not.toContain('<tool_call>');
    expect(final).not.toContain('<think>');
  }, TIMEOUT);
});

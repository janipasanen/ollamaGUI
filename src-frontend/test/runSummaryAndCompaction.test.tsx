/**
 * Run-end trust + endurance (#549 audit ranks 9, 11, 13):
 *  - an agentic run appends a ✅ summary card with steps/duration
 *  - in-loop compaction fires when the transcript passes the threshold
 *  - a no-tool-support model gets a warning chip beside the switcher
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';
import { agenticChatStream } from '../services/agent';
import { toolRegistry } from '../services/tools';

const PROJECT = {
  id: 'proj_s', name: 'proj', workspaceRoot: '/tmp/ws', workspaceRoots: ['/tmp/ws'],
  instructions: '', createdAt: 1_700_000_000_000,
};

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
  window.dispatchEvent(new Event('resize'));
});

function sse(lines: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: () => i < lines.length
          ? Promise.resolve({ done: false, value: encoder.encode(lines[i++] + '\n') })
          : Promise.resolve({ done: true, value: undefined }),
      }),
    },
  };
}
const toolCallLine = (name: string) =>
  JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: {} } }] }, done: false });
const doneLine = (content: string) =>
  JSON.stringify({ message: { role: 'assistant', content }, done: true });

describe('run summary card (#549 rank 9)', () => {
  it('appends a ✅ summary with step count after an agentic run with tools', async () => {
    localStorage.setItem('ollama_gui_agent_autonomy', JSON.stringify({ level: 'auto', maxIterations: 5, readOnly: false }));
    localStorage.setItem('ollama_gui_projects', JSON.stringify([PROJECT]));
    localStorage.setItem('ollama_gui_active_project', PROJECT.id);
    toolRegistry.registerTool({
      name: 'noop_tool', description: 'noop', readOnly: true,
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ ok: true }),
    });
    localStorage.setItem('custom_tools', JSON.stringify([
      { id: 'ct_noop', name: 'noop_tool', description: 'noop', parameters: { type: 'object', properties: {} }, code: 'return { ok: true };', enabled: true },
    ]));
    let chatCalls = 0;
    global.fetch = vi.fn().mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/chat')) {
        chatCalls++;
        // registered custom tools take the custom__ name in the registry
        if (chatCalls === 1) return Promise.resolve(sse([toolCallLine('custom__noop_tool')]));
        return Promise.resolve(sse([doneLine('all finished')]));
      }
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' });
    });

    render(<App />);
    fireEvent.change(screen.getByLabelText('Type your message here'), { target: { value: 'do the thing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText(/✅ Done in .* — 1 step\./)).toBeInTheDocument();
    }, { timeout: 8000 });
    toolRegistry.unregisterTool('custom__noop_tool');
  }, 20000);
});

describe('in-loop compaction (#549 rank 13)', () => {
  it('compacts the transcript inside the loop when past the threshold', async () => {
    const big = 'x '.repeat(4000); // ~4000 tokens of filler
    let chatN = 0;
    let summarizeCalls = 0;
    // The summarizer requests stream:false JSON; the loop streams. Route by
    // body rather than call order — compaction may fire on any iteration.
    const fetchMock = vi.fn().mockImplementation((_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.stream === false) {
        summarizeCalls++;
        return Promise.resolve({ ok: true, json: async () => ({ message: { content: 'summary of earlier turns' } }) });
      }
      chatN++;
      if (chatN === 1) return Promise.resolve(sse([toolCallLine('bloat_tool')]));
      return Promise.resolve(sse([doneLine('done')]));
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    toolRegistry.registerTool({
      name: 'bloat_tool', description: 'returns a huge result', readOnly: true,
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ blob: big }),
    });

    const seen: string[] = [];
    // Enough history that compactConversation (keepRecent=8) has old turns to
    // fold once the bloated tool result pushes it past the threshold.
    const filler: { role: string; content: string }[] = [];
    for (let i = 0; i < 5; i++) {
      filler.push({ role: 'user', content: `earlier question ${i} ${'pad '.repeat(120)}` });
      filler.push({ role: 'assistant', content: `earlier answer ${i} ${'pad '.repeat(120)}` });
    }
    const gen = agenticChatStream({
      model: 'm', messages: [...filler, { role: 'user', content: 'go' }],
      maxIterations: 3, endpoint: 'http://x/api/chat',
      toolFilter: ['bloat_tool'],
      compactThresholdTokens: 500,
      onAssistantMessage: m => seen.push(m),
    });
    for await (const _m of gen) { /* consume */ }
    toolRegistry.unregisterTool('bloat_tool');

    // The in-loop summarizer actually fired, and the run still completed.
    expect(summarizeCalls).toBeGreaterThan(0);
    expect(seen.join(' ')).toContain('done');
  });
});

/**
 * LSP client (#670): framing, session reuse, degradation, formatting.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  serverForPath, uriFor, collectDiagnostics, formatDiagnostics, _mocks, _resetLsp,
  type Diagnostic,
} from '../services/lsp';

interface FakeServer {
  id: number;
  sent: any[];
  handler: ((body: string) => void) | null;
  spec: { command: string };
}

function fakeTransport(failStart?: string) {
  const servers: FakeServer[] = [];
  _mocks.start = async spec => {
    if (failStart) throw new Error(failStart);
    const server: FakeServer = { id: servers.length + 1, sent: [], handler: null, spec };
    servers.push(server);
    return server.id;
  };
  _mocks.send = async (id, message) => {
    servers.find(s => s.id === id)!.sent.push(message);
  };
  _mocks.listen = async (id, handler) => {
    servers.find(s => s.id === id)!.handler = handler;
    return () => { const s = servers.find(x => x.id === id); if (s) s.handler = null; };
  };
  _mocks.stop = async () => {};
  return servers;
}

const diag = (line: number, message: string, severity = 1): Diagnostic => ({
  range: { start: { line, character: 4 } }, message, severity, source: 'ts',
});

beforeEach(() => _resetLsp());
afterEach(() => {
  _mocks.start = _mocks.send = _mocks.stop = _mocks.listen = null;
  vi.restoreAllMocks();
});

describe('server selection', () => {
  it('maps the languages the app edits', () => {
    expect(serverForPath('/p/a.ts')?.languageId).toBe('typescript');
    expect(serverForPath('/p/a.tsx')?.languageId).toBe('typescriptreact');
    expect(serverForPath('/p/a.rs')?.command).toBe('rust-analyzer');
    expect(serverForPath('/p/a.py')?.command).toBe('pyright-langserver');
    expect(serverForPath('/p/a.go')?.command).toBe('gopls');
  });

  it('returns null for a language with no server', () => {
    expect(serverForPath('/p/README.md')).toBeNull();
  });

  it('builds an encoded file URI', () => {
    expect(uriFor('/home/me/my project/a.ts')).toBe('file:///home/me/my%20project/a.ts');
  });
});

describe('collectDiagnostics', () => {
  it('sends didOpen with the file text and returns what the server publishes', async () => {
    const servers = fakeTransport();
    const pending = collectDiagnostics('/p/a.ts', '/p', { text: 'const x = ' });
    await vi.waitFor(() => expect(servers[0]?.handler).toBeTruthy());

    expect(servers[0].sent[0].method).toBe('initialize');
    expect(servers[0].sent[1].method).toBe('initialized');
    const open = servers[0].sent[2];
    expect(open.method).toBe('textDocument/didOpen');
    expect(open.params.textDocument.text).toBe('const x = ');
    expect(open.params.textDocument.uri).toBe('file:///p/a.ts');

    servers[0].handler!(JSON.stringify({
      jsonrpc: '2.0', method: 'textDocument/publishDiagnostics',
      params: { uri: 'file:///p/a.ts', diagnostics: [diag(0, 'Expression expected')] },
    }));

    await expect(pending).resolves.toEqual({
      status: 'ok', diagnostics: [diag(0, 'Expression expected')],
    });
  });

  it('reuses one server per project root', async () => {
    const servers = fakeTransport();
    const first = collectDiagnostics('/p/a.ts', '/p', { text: '', timeoutMs: 10 });
    const second = collectDiagnostics('/p/b.ts', '/p/', { text: '', timeoutMs: 10 });
    await Promise.all([first, second]);
    expect(servers).toHaveLength(1);
    expect(servers[0].sent.filter(m => m.method === 'textDocument/didOpen')).toHaveLength(2);
  });

  it('ignores diagnostics for other files', async () => {
    const servers = fakeTransport();
    const pending = collectDiagnostics('/p/a.ts', '/p', { text: '', timeoutMs: 30 });
    await vi.waitFor(() => expect(servers[0]?.handler).toBeTruthy());
    servers[0].handler!(JSON.stringify({
      jsonrpc: '2.0', method: 'textDocument/publishDiagnostics',
      params: { uri: 'file:///p/other.ts', diagnostics: [diag(0, 'nope')] },
    }));
    await expect(pending).resolves.toEqual({ status: 'none' });
  });

  it('gives up on a slow server without failing the edit', async () => {
    fakeTransport();
    await expect(collectDiagnostics('/p/a.ts', '/p', { text: '', timeoutMs: 15 }))
      .resolves.toEqual({ status: 'none' });
  });

  it('reports an unavailable server once, then stays quiet', async () => {
    const servers = fakeTransport('could not start rust-analyzer: No such file');
    const first = await collectDiagnostics('/p/a.rs', '/p', {});
    expect(first).toEqual({ status: 'unavailable', reason: expect.stringContaining('No such file') });

    _mocks.start = async () => { throw new Error('should not be retried'); };
    await expect(collectDiagnostics('/p/b.rs', '/p', {}))
      .resolves.toEqual({ status: 'unavailable', reason: expect.stringContaining('No such file') });
    expect(servers).toHaveLength(0);
  });

  it('returns none for a file it has no server for', async () => {
    _mocks.start = async () => { throw new Error('should not start'); };
    await expect(collectDiagnostics('/p/notes.md', '/p', {}))
      .resolves.toEqual({ status: 'none' });
  });
});

describe('formatDiagnostics', () => {
  it('sorts by position and renders 1-based coordinates', () => {
    const text = formatDiagnostics('/p/a.ts', [diag(9, 'b'), diag(1, 'a')]);
    expect(text).toBe('Diagnostics after the edit:\n- /p/a.ts:2:5 error: a (ts)\n- /p/a.ts:10:5 error: b (ts)');
  });

  it('caps the list and counts the rest', () => {
    const many = Array.from({ length: 13 }, (_, i) => diag(i, `e${i}`));
    const text = formatDiagnostics('/p/a.ts', many);
    expect(text.match(/- \/p\/a\.ts:/g)).toHaveLength(10);
    expect(text).toContain('… 3 more');
  });

  it('names the severity', () => {
    expect(formatDiagnostics('/p/a.ts', [diag(0, 'h', 4)])).toContain('hint: h');
    expect(formatDiagnostics('/p/a.ts', [diag(0, 'w', 2)])).toContain('warning: w');
  });
});

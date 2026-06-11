import { describe, it, expect } from 'vitest';
import { MCP_SERVER_PRESETS, getMcpPreset } from '../services/mcpPresets';
import { splitCommandLine } from '../services/mcp';

describe('MCP server presets', () => {
  it('includes all required connectors', () => {
    const keys = MCP_SERVER_PRESETS.map(p => p.key).sort();
    expect(keys).toEqual(
      ['atlassian-rovo', 'database', 'faq', 'filesystem', 'github', 'gitlab', 'jira'].sort(),
    );
  });

  it('every preset has name, icon, description and docs link', () => {
    for (const p of MCP_SERVER_PRESETS) {
      expect(p.name).toMatch(/.+/);
      expect(p.icon).toMatch(/.+/);
      expect(p.description).toMatch(/.+/);
      expect(p.docsUrl).toMatch(/^https?:\/\//);
      expect(p.command || p.url).toBeTruthy();
    }
  });

  it('Filesystem is a stdio server invoking the official server package', () => {
    const fs = getMcpPreset('filesystem')!;
    expect(fs.type).toBe('stdio');
    expect(fs.command).toContain('server-filesystem');
  });

  it('Atlassian Rovo is the official remote HTTP server with OAuth', () => {
    const rovo = getMcpPreset('atlassian-rovo')!;
    expect(rovo.type).toBe('http');
    expect(rovo.authRequired).toBe(true);
    expect(rovo.url).toBe('https://mcp.atlassian.com/v1/mcp');
  });

  it('credential-based connectors declare secret env fields', () => {
    for (const key of ['github', 'gitlab', 'jira']) {
      const p = getMcpPreset(key)!;
      expect(p.env && p.env.length).toBeGreaterThan(0);
      expect(p.env!.some(f => f.secret)).toBe(true);
    }
  });

  it('Database connector targets PostgreSQL', () => {
    const db = getMcpPreset('database')!;
    expect(db.type).toBe('stdio');
    expect(db.command).toContain('postgres');
  });

  it('getMcpPreset returns undefined for an unknown key', () => {
    expect(getMcpPreset('nope')).toBeUndefined();
  });
});

describe('splitCommandLine', () => {
  it('splits a simple command into bin + args', () => {
    expect(splitCommandLine('npx -y @modelcontextprotocol/server-github')).toEqual({
      bin: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    });
  });

  it('keeps double-quoted paths with spaces as one arg', () => {
    expect(splitCommandLine('npx -y server-fs "/Users/me/My Project"')).toEqual({
      bin: 'npx',
      args: ['-y', 'server-fs', '/Users/me/My Project'],
    });
  });

  it('keeps single-quoted segments together', () => {
    expect(splitCommandLine("uvx mcp-atlassian 'a b'")).toEqual({
      bin: 'uvx',
      args: ['mcp-atlassian', 'a b'],
    });
  });

  it('handles an empty string', () => {
    expect(splitCommandLine('')).toEqual({ bin: '', args: [] });
  });

  it('handles a bare command with no args', () => {
    expect(splitCommandLine('echo')).toEqual({ bin: 'echo', args: [] });
  });
});

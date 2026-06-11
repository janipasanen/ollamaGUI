import { describe, it, expect } from 'vitest';
import { MCP_SERVER_PRESETS, getMcpPreset } from '../services/mcpPresets';
import { splitCommandLine } from '../services/mcp';

describe('MCP server presets', () => {
  it('includes all required connectors', () => {
    const keys = MCP_SERVER_PRESETS.map(p => p.key).sort();
    expect(keys).toEqual(
      ['atlassian-rovo', 'database', 'faq', 'filesystem', 'github', 'gitlab', 'jira', 'supabase'].sort(),
    );
  });

  it('Supabase is an OAuth remote server, project-scoped + read-only by default', () => {
    const sb = getMcpPreset('supabase')!;
    expect(sb.type).toBe('http');
    expect(sb.authRequired).toBe(true);
    expect(sb.url).toContain('mcp.supabase.com/mcp');
    expect(sb.url).toContain('project_ref=');
    expect(sb.url).toContain('read_only=true');
    // read-write + all-projects variants exist and carry security notes
    expect(sb.variants!.length).toBeGreaterThanOrEqual(2);
    expect(sb.variants!.every(v => v.securityNote)).toBe(true);
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

  it('Atlassian Rovo uses the explicit authv2 remote endpoint', () => {
    const rovo = getMcpPreset('atlassian-rovo')!;
    expect(rovo.type).toBe('http');
    expect(rovo.authRequired).toBe(true);
    expect(rovo.url).toBe('https://mcp.atlassian.com/v1/mcp/authv2');
  });

  it('GitHub defaults to the maintained remote server with a Docker + legacy variant', () => {
    const gh = getMcpPreset('github')!;
    expect(gh.type).toBe('http');
    expect(gh.url).toBe('https://api.githubcopilot.com/mcp/');
    expect(gh.authRequired).toBe(true);
    const docker = gh.variants!.find(v => /docker/i.test(v.label));
    expect(docker?.command).toContain('ghcr.io/github/github-mcp-server');
    expect(docker?.env?.some(f => f.key === 'GITHUB_PERSONAL_ACCESS_TOKEN')).toBe(true);
    expect(gh.variants!.some(v => v.deprecated)).toBe(true); // legacy npm flagged
  });

  it('GitLab defaults to the in-product HTTP MCP with a deprecated npm fallback', () => {
    const gl = getMcpPreset('gitlab')!;
    expect(gl.type).toBe('http');
    expect(gl.url).toContain('/api/v4/mcp');
    expect(gl.authRequired).toBe(true);
    expect(gl.variants!.some(v => v.deprecated && /npm/i.test(v.label))).toBe(true);
  });

  it('Jira (token) stays stdio with a secret env field', () => {
    const jira = getMcpPreset('jira')!;
    expect(jira.type).toBe('stdio');
    expect(jira.env!.some(f => f.secret)).toBe(true);
  });

  it('Database defaults to the maintained postgres-mcp; archived server is a flagged variant', () => {
    const db = getMcpPreset('database')!;
    expect(db.type).toBe('stdio');
    expect(db.command).toContain('postgres-mcp');
    expect(db.command).not.toContain('server-postgres'); // not the archived reference server by default
    const archived = db.variants!.find(v => v.command?.includes('server-postgres'));
    expect(archived?.deprecated).toBe(true);
    expect(archived?.securityNote).toMatch(/SQL-injection|read-only/i);
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

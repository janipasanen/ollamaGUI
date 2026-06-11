import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadProjectRules, formatRulesContent, _mocks } from '../services/projectRules';

beforeEach(() => {
  _mocks.readFile = null;
});

afterEach(() => {
  _mocks.readFile = null;
});

describe('loadProjectRules (#93)', () => {
  it('returns null when no rules file exists', async () => {
    _mocks.readFile = async () => { throw new Error('not found'); };
    const result = await loadProjectRules('/project');
    expect(result).toBeNull();
  });

  it('reads AGENTS.md when present', async () => {
    _mocks.readFile = async (path) => {
      if (path.endsWith('AGENTS.md')) return '# Agents rules\nAlways use TypeScript.';
      throw new Error('not found');
    };
    const result = await loadProjectRules('/project');
    expect(result).toContain('Always use TypeScript.');
  });

  it('reads CLAUDE.md as fallback when AGENTS.md is missing', async () => {
    _mocks.readFile = async (path) => {
      if (path.endsWith('CLAUDE.md')) return '# Claude instructions\nPrefer functional style.';
      throw new Error('not found');
    };
    const result = await loadProjectRules('/project');
    expect(result).toContain('Prefer functional style.');
  });

  it('prefers AGENTS.md over CLAUDE.md (AGENTS.md checked first)', async () => {
    _mocks.readFile = async (path) => {
      if (path.endsWith('AGENTS.md')) return 'AGENTS content';
      if (path.endsWith('CLAUDE.md')) return 'CLAUDE content';
      throw new Error('not found');
    };
    const result = await loadProjectRules('/project');
    expect(result).toBe('AGENTS content');
  });

  it('reads lowercase agents.md variant', async () => {
    _mocks.readFile = async (path) => {
      if (path.endsWith('agents.md')) return 'lowercase rules';
      throw new Error('not found');
    };
    const result = await loadProjectRules('/project');
    expect(result).toBe('lowercase rules');
  });

  it('skips empty files and tries the next candidate', async () => {
    _mocks.readFile = async (path) => {
      if (path.endsWith('AGENTS.md')) return '   '; // whitespace-only
      if (path.endsWith('agents.md')) return 'fallback content';
      throw new Error('not found');
    };
    const result = await loadProjectRules('/project');
    expect(result).toBe('fallback content');
  });

  it('handles trailing slash in workspace root gracefully', async () => {
    _mocks.readFile = async (path) => {
      // Should NOT produce double slashes like /project//AGENTS.md
      if (path === '/project/AGENTS.md') return 'ok';
      throw new Error('not found');
    };
    const result = await loadProjectRules('/project/');
    expect(result).toBe('ok');
  });
});

describe('formatRulesContent (#93)', () => {
  it('trims whitespace', () => {
    expect(formatRulesContent('  hello  ')).toBe('hello');
  });

  it('preserves internal newlines', () => {
    const content = '# Title\nLine 1\nLine 2';
    expect(formatRulesContent(content)).toBe(content);
  });
});

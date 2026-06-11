import { describe, it, expect, beforeEach } from 'vitest';
import { storage, type Project, type ChatSession } from '../services/storage';

beforeEach(() => {
  localStorage.clear();
});

// ── Project CRUD ──────────────────────────────────────────────────────────────

describe('projects CRUD (#92)', () => {
  const p1: Project = { id: 'p1', name: 'My Project', workspaceRoot: '/home/user/repo', instructions: 'Always use TypeScript.', createdAt: 1 };
  const p2: Project = { id: 'p2', name: 'Other', workspaceRoot: '', instructions: '', createdAt: 2 };

  it('getProjects returns empty array when none stored', () => {
    expect(storage.getProjects()).toEqual([]);
  });

  it('saveProject creates and retrieves a project', () => {
    storage.saveProject(p1);
    const projects = storage.getProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('My Project');
  });

  it('saveProject updates existing project in-place', () => {
    storage.saveProject(p1);
    storage.saveProject({ ...p1, name: 'Renamed' });
    const projects = storage.getProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Renamed');
  });

  it('deleteProject removes the project', () => {
    storage.saveProject(p1);
    storage.saveProject(p2);
    storage.deleteProject('p1');
    const names = storage.getProjects().map(p => p.name);
    expect(names).not.toContain('My Project');
    expect(names).toContain('Other');
  });

  it('deleteProject detaches sessions from that project', () => {
    storage.saveProject(p1);
    const session: ChatSession = {
      id: 's1', title: 'test', messages: [], createdAt: 1, model: 'llama3', projectId: 'p1',
    };
    storage.saveSession(session);
    storage.deleteProject('p1');
    const s = storage.getSessions().find(s => s.id === 's1');
    expect(s?.projectId).toBeUndefined();
  });
});

// ── Session filtering by projectId ───────────────────────────────────────────

describe('session projectId filtering (#92)', () => {
  it('ChatSession accepts a projectId field', () => {
    const session: ChatSession = {
      id: 's1', title: 'scoped', messages: [], createdAt: 1, model: 'llama3', projectId: 'proj1',
    };
    storage.saveSession(session);
    const found = storage.getSessions().find(s => s.id === 's1');
    expect(found?.projectId).toBe('proj1');
  });

  it('sessions without projectId survive migration', () => {
    const session: ChatSession = {
      id: 's2', title: 'legacy', messages: [], createdAt: 1, model: 'llama3',
    };
    storage.saveSession(session);
    const found = storage.getSessions().find(s => s.id === 's2');
    expect(found?.projectId).toBeUndefined();
  });

  it('can filter sessions by projectId', () => {
    const a: ChatSession = { id: 'a', title: 'a', messages: [], createdAt: 1, model: 'llama3', projectId: 'pA' };
    const b: ChatSession = { id: 'b', title: 'b', messages: [], createdAt: 2, model: 'llama3', projectId: 'pB' };
    const c: ChatSession = { id: 'c', title: 'c', messages: [], createdAt: 3, model: 'llama3' };
    [a, b, c].forEach(s => storage.saveSession(s));
    const pA = storage.getSessions().filter(s => s.projectId === 'pA');
    expect(pA).toHaveLength(1);
    expect(pA[0].id).toBe('a');
  });
});

// ── Project instructions compose into system prompt ────────────────────────────

import { composeSystemPrompt } from '../services/systemPrompt';

describe('composeSystemPrompt (#92 / #95)', () => {
  it('returns systemPrompt alone when no additions', () => {
    const result = composeSystemPrompt({ systemPrompt: 'Be helpful.' });
    expect(result).toBe('Be helpful.');
  });

  it('prepends project instructions when provided', () => {
    const result = composeSystemPrompt({
      systemPrompt: 'Be helpful.',
      projectInstructions: 'Always use TypeScript.',
    });
    expect(result).toContain('Always use TypeScript.');
    expect(result).toContain('Be helpful.');
    // instructions must appear before systemPrompt
    expect(result.indexOf('Always use TypeScript.')).toBeLessThan(result.indexOf('Be helpful.'));
  });

  it('prepends rulesFileContent when provided', () => {
    const result = composeSystemPrompt({
      systemPrompt: 'Be helpful.',
      rulesFileContent: '# Project Rules\n- No global variables',
    });
    expect(result).toContain('No global variables');
    expect(result.indexOf('No global variables')).toBeLessThan(result.indexOf('Be helpful.'));
  });

  it('prepends memory block when provided', () => {
    const result = composeSystemPrompt({
      systemPrompt: 'Be helpful.',
      memoryBlock: '--- Persistent Memory ---\n- User prefers dark mode\n---',
    });
    expect(result).toContain('User prefers dark mode');
    expect(result.indexOf('User prefers dark mode')).toBeLessThan(result.indexOf('Be helpful.'));
  });

  it('stacks all components in correct order', () => {
    const result = composeSystemPrompt({
      systemPrompt: 'BASE',
      rulesFileContent: 'RULES',
      projectInstructions: 'PROJ',
      memoryBlock: 'MEM',
    });
    const rulesIdx = result.indexOf('RULES');
    const projIdx = result.indexOf('PROJ');
    const memIdx = result.indexOf('MEM');
    const baseIdx = result.indexOf('BASE');
    // Ordered: rules → project → memory → base
    expect(rulesIdx).toBeLessThan(projIdx);
    expect(projIdx).toBeLessThan(memIdx);
    expect(memIdx).toBeLessThan(baseIdx);
  });
});

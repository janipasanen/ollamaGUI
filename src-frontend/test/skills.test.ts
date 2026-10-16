import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSkills, saveSkills, addSkill, updateSkill, removeSkill,
  getRelevantSkills, composeSkillBlock, recordUsage,
  recordToolSequence, autoCaptureSkill,
  _registerToolDescription, _unregisterToolDescription,
  type Skill,
} from '../services/skills';

beforeEach(() => {
  localStorage.clear();
});

describe('skill CRUD (#670)', () => {
  it('loadSkills returns empty array when nothing stored', () => {
    expect(loadSkills()).toEqual([]);
  });

  it('addSkill persists with id, usageCount 0, timestamps', () => {
    const s = addSkill({ title: 'T', description: 'D', content: 'C', tags: [], scope: 'global', source: 'manual' });
    expect(s.id).toBeTruthy();
    expect(s.usageCount).toBe(0);
    expect(s.createdAt).toBeGreaterThan(0);
    expect(s.updatedAt).toBeGreaterThan(0);
    expect(loadSkills()).toHaveLength(1);
  });

  it('updateSkill patches content/tags and bumps updatedAt', () => {
    const s = addSkill({ title: 'T', description: 'D', content: 'C', tags: [], scope: 'global', source: 'manual' });
    const before = Date.now();
    const updated = updateSkill(s.id, { content: 'C2', tags: ['a', 'b'] });
    expect(updated?.content).toBe('C2');
    expect(updated?.tags).toEqual(['a', 'b']);
    // updatedAt must be at least as new as the original creation time.
    expect(updated?.updatedAt ?? 0).toBeGreaterThanOrEqual(before);
    expect(updated?.updatedAt ?? 0).toBeGreaterThanOrEqual(updated?.createdAt ?? 0);
  });

  it('updateSkill returns null for unknown id', () => {
    expect(updateSkill('nope', { content: 'x' })).toBeNull();
  });

  it('removeSkill deletes by id', () => {
    const s = addSkill({ title: 'x', description: 'y', content: 'z', tags: [], scope: 'global', source: 'manual' });
    expect(removeSkill(s.id)).toBe(true);
    expect(loadSkills()).toHaveLength(0);
    expect(removeSkill(s.id)).toBe(false);
  });

  it('round-trips through save/load', () => {
    const s = addSkill({ title: 'keep', description: 'd', content: 'c', tags: ['t'], scope: 'local', source: 'manual', projectId: 'p1' });
    saveSkills(loadSkills());
    expect(loadSkills()[0]).toMatchObject({ id: s.id, scope: 'local', projectId: 'p1' });
  });
});

describe('getRelevantSkills (#670)', () => {
  beforeEach(() => {
    addSkill({ title: 'Review a PR', description: 'Review code quality and tests', content: 'step one', tags: ['review'], scope: 'global', source: 'manual' });
    addSkill({ title: 'Fix test timeout', description: 'Increase timeout and reduce worker pressure', content: 'step two', tags: ['tests'], scope: 'global', source: 'manual' });
    addSkill({ title: 'Project-specific build', description: 'How to build in this repo', content: 'step three', tags: ['build'], scope: 'local', source: 'manual', projectId: 'proj1' });
  });

  it('matches by title, description, tags', () => {
    const found = getRelevantSkills('review code', undefined, 8);
    expect(found.map(s => s.title)).toContain('Review a PR');
  });

  it('returns global + project-local for a projectId', () => {
    // A skill scoped to a *different* project must not leak in.
    addSkill({ title: 'Other proj build', description: 'build for proj2', content: 'c', tags: ['build'], scope: 'local', source: 'manual', projectId: 'proj2' });
    const found = getRelevantSkills('', 'proj1', 10);
    const titles = found.map(s => s.title);
    expect(titles).toContain('Review a PR');             // global
    expect(titles).toContain('Project-specific build');  // local to proj1
    expect(titles).not.toContain('Other proj build');    // local to proj2
  });

  it('ranks by relevance then usageCount', () => {
    const base = addSkill({ title: 'Deploy', description: 'Deploy the service', content: 'x', tags: [], scope: 'global', source: 'manual' });
    recordUsage(base.id);
    const q = getRelevantSkills('deploy', undefined, 8);
    expect(q[0].id).toBe(base.id);
  });
});

describe('composeSkillBlock (#670)', () => {
  it('returns empty string when no skills', () => {
    expect(composeSkillBlock('anything')).toBe('');
  });

  it('includes a skills index header', () => {
    addSkill({ title: 'Do Things', description: 'How to do things well', content: 'full content here', tags: [], scope: 'global', source: 'manual' });
    const block = composeSkillBlock('things');
    expect(block).toContain('--- Skills ---');
    expect(block).toContain('Do Things');
    expect(block).toContain('How to do things well');
  });

  it('includes full content of the top match within budget', () => {
    addSkill({ title: 'Alpha', description: 'Alpha work', content: 'THE-ALPHA-CONTENT', tags: ['alpha'], scope: 'global', source: 'manual' });
    const block = composeSkillBlock('alpha');
    expect(block).toContain('THE-ALPHA-CONTENT');
  });

  it('honours maxChars limit', () => {
    for (let i = 0; i < 15; i++) {
      addSkill({ title: `Skill ${i}`, description: `Description ${'x'.repeat(60)} ${i}`, content: `Content ${'y'.repeat(80)} ${i}`, tags: ['t'], scope: 'global', source: 'manual' });
    }
    const block = composeSkillBlock('', undefined, 400);
    expect(block.length).toBeLessThanOrEqual(460);
  });
});

describe('recordUsage (#670)', () => {
  it('increments usageCount and sets lastUsedAt', () => {
    const s = addSkill({ title: 'U', description: 'd', content: 'c', tags: [], scope: 'global', source: 'manual' });
    recordUsage(s.id);
    recordUsage(s.id);
    const after = loadSkills().find(x => x.id === s.id);
    expect(after?.usageCount).toBe(2);
    expect(after?.lastUsedAt).toBeGreaterThan(0);
  });
});

describe('self-learning: recordToolSequence + autoCaptureSkill (#670)', () => {
  beforeEach(() => {
    // Simulate the tool registry the UI would populate at init.
    _registerToolDescription('read_file', 'Read a file from disk');
    _registerToolDescription('write_file', 'Write a file to disk');
    _registerToolDescription('run_tests', 'Run the project test suite');
    _unregisterToolDescription('unrelated');
  });

  it('does not capture when fewer than 2 distinct tools', () => {
    const s = autoCaptureSkill({ prompt: 'Do the thing', tools: ['read_file'] });
    expect(s).toBeNull();
  });

  it('captures a skill from a 2-tool sequence', () => {
    const s = autoCaptureSkill({ prompt: 'Add a new endpoint and verify it', tools: ['read_file', 'run_tests'] });
    expect(s).not.toBeNull();
    expect(s?.source).toBe('auto');
    expect(s?.content).toContain('read_file');
    expect(s?.content).toContain('run_tests');
  });

  it('records the tool sequence even on failure (no capture via direct call)', () => {
    recordToolSequence('Broken thing', ['read_file', 'run_tests'], false);
    const seqs = JSON.parse(localStorage.getItem('ollama_gui_recent_tool_sequences') ?? '[]');
    expect(seqs).toHaveLength(1);
    expect(seqs[0].success).toBe(false);
  });

  it('does not duplicate an identical captured skill', () => {
    const first = autoCaptureSkill({ prompt: 'Fix the bug', tools: ['read_file', 'write_file'] });
    const second = autoCaptureSkill({ prompt: 'Fix the bug', tools: ['read_file', 'write_file'] });
    expect(second?.id).toBe(first?.id);
    expect(loadSkills()).toHaveLength(1);
  });

  it('derives a human-readable title from the prompt', () => {
    const s = autoCaptureSkill({ prompt: 'Review and merge this feature branch', tools: ['read_file', 'run_tests'] });
    expect(s?.title.toLowerCase()).toContain('review');
  });
});

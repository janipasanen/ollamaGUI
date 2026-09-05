/**
 * Prompt Library → user slash command migration (#549 audit rank 15).
 *
 * The Prompt Library UI was deleted from Settings; user data must survive.
 * On boot, App converts each saved prompt into a user slash command
 * (slugified name, description 'migrated prompt', body as template) and
 * clears the old store so the migration only ever runs once.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import App from '../App';
import { loadPrompts, savePrompts, type SavedPrompt } from '../services/promptLibrary';
import { loadUserCommands } from '../services/commands';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ models: [] }), body: null, text: async () => '',
  } as any);
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
});

function seedPrompts(prompts: Array<Pick<SavedPrompt, 'name' | 'body'>>) {
  savePrompts(prompts.map((p, i) => ({ ...p, id: `p${i}`, createdAt: i + 1 })));
}

describe('prompt library migration on boot (#549 rank 15)', () => {
  it('turns each saved prompt into a user slash command and clears the store', async () => {
    seedPrompts([{ name: 'Code Review!', body: 'Review this code carefully.' }]);

    render(<App />);

    await waitFor(() => {
      const cmds = loadUserCommands();
      const migrated = cmds.find(c => c.name === 'code-review');
      expect(migrated).toBeTruthy();
      expect(migrated!.description).toBe('migrated prompt');
      expect(migrated!.template).toBe('Review this code carefully.');
    });
    // The old store is emptied so the migration never re-runs.
    expect(loadPrompts()).toHaveLength(0);
  });

  it('dedupes slugs against existing commands and other prompts', async () => {
    // 'review' collides with the builtin /review command; two identical
    // prompt names collide with each other.
    seedPrompts([
      { name: 'Review', body: 'body one' },
      { name: 'Review', body: 'body two' },
    ]);

    render(<App />);

    await waitFor(() => {
      const names = loadUserCommands().map(c => c.name);
      expect(names).toContain('review-2');
      expect(names).toContain('review-3');
    });
    const cmds = loadUserCommands();
    expect(cmds.find(c => c.name === 'review-2')!.template).toBe('body one');
    expect(cmds.find(c => c.name === 'review-3')!.template).toBe('body two');
    expect(loadPrompts()).toHaveLength(0);
  });

  it('skips blank-bodied prompts and does nothing when the store is empty', async () => {
    seedPrompts([{ name: 'Empty', body: '   ' }]);

    render(<App />);

    await waitFor(() => expect(loadPrompts()).toHaveLength(0));
    expect(loadUserCommands().find(c => c.description === 'migrated prompt')).toBeUndefined();
  });
});

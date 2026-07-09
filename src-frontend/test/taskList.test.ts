import { describe, it, expect } from 'vitest';
import {
  toggleTaskInMarkdown,
  hasTaskList,
  reactChildrenToText,
  extractTaskText,
} from '../services/taskList';

describe('hasTaskList (#352)', () => {
  it('detects a GFM task list item', () => {
    expect(hasTaskList('- [ ] Task one')).toBe(true);
    expect(hasTaskList('- [x] Task one')).toBe(true);
    expect(hasTaskList('* [ ] Task one')).toBe(true);
    expect(hasTaskList('+ [X] Task one')).toBe(true);
  });
  it('rejects non-task lines', () => {
    expect(hasTaskList('- not a task')).toBe(false);
    expect(hasTaskList('plain text')).toBe(false);
  });
});

describe('toggleTaskInMarkdown (#352)', () => {
  it('flips an unchecked item to checked', () => {
    const out = toggleTaskInMarkdown('- [ ] Task one', 'Task one', false);
    expect(out).toBe('- [x] Task one');
  });
  it('flips a checked item back to unchecked', () => {
    const out = toggleTaskInMarkdown('- [x] Task one', 'Task one', true);
    expect(out).toBe('- [ ] Task one');
  });
  it('preserves indentation and marker', () => {
    const out = toggleTaskInMarkdown('  * [ ] do it', 'do it', false);
    expect(out).toBe('  * [x] do it');
  });
  it('only flips the matching item among several', () => {
    const md = '- [ ] Task one\n- [ ] Task two\n- [x] Task three';
    const out = toggleTaskInMarkdown(md, 'Task two', false);
    expect(out).toBe('- [ ] Task one\n- [x] Task two\n- [x] Task three');
  });
  it('no-ops when the text does not match', () => {
    expect(toggleTaskInMarkdown('- [ ] Task one', 'Task two', false)).toBe('- [ ] Task one');
  });
  it('no-ops when the current checked state does not match', () => {
    // looking for an unchecked item to flip FROM unchecked, but it is already checked
    expect(toggleTaskInMarkdown('- [x] Task one', 'Task one', false)).toBe('- [x] Task one');
  });
  it('returns content unchanged for empty itemText', () => {
    expect(toggleTaskInMarkdown('- [ ] Task one', '', false)).toBe('- [ ] Task one');
  });
  it('toggles within surrounding prose', () => {
    const md = 'Here is a list:\n\n- [ ] buy milk\n- [ ] walk dog\n\ndone!';
    const out = toggleTaskInMarkdown(md, 'walk dog', false);
    expect(out).toContain('- [x] walk dog');
    expect(out).toContain('Here is a list:');
  });
});

describe('reactChildrenToText (#352)', () => {
  it('joins string children', () => {
    expect(reactChildrenToText(['Task ', 'one'])).toBe('Task one');
  });
  it('extracts text from element children', () => {
    const el = { props: { children: ['use ', { props: { children: 'foo' } }] } };
    expect(reactChildrenToText(el)).toBe('use foo');
  });
  it('handles null/boolean/number', () => {
    expect(reactChildrenToText([null, true, 42, 'x'])).toBe('42x');
  });
});

describe('extractTaskText (#352)', () => {
  it('extracts label from a task-list item mdast node', () => {
    const node = { children: [{ children: [{ value: 'Task one' }] }] };
    expect(extractTaskText(node)).toBe('Task one');
  });
  it('returns empty string for a node without children', () => {
    expect(extractTaskText({})).toBe('');
  });
});

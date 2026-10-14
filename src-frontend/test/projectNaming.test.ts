import { describe, it, expect } from 'vitest';
import {
  basename, folderLabel, deriveProjectName, isAutoFolderName, MAX_PROJECT_NAME,
} from '../services/projectNaming';

describe('basename (#542)', () => {
  it('takes the last segment of posix and windows paths', () => {
    expect(basename('/Users/me/projects/demo')).toBe('demo');
    expect(basename('C:\\src\\app')).toBe('app');
  });

  it('ignores trailing separators', () => {
    expect(basename('/Users/me/demo/')).toBe('demo');
    expect(basename('/Users/me/demo//')).toBe('demo');
  });

  it('returns the input when there is nothing to strip', () => {
    expect(basename('demo')).toBe('demo');
  });
});

describe('folderLabel (#543)', () => {
  it('is empty when a project has no folders', () => {
    expect(folderLabel([])).toBe('');
  });

  it('shows just the basename for a single-folder project', () => {
    expect(folderLabel(['/repos/api'])).toBe('api');
  });

  it('adds a count for multi-repo projects rather than listing them', () => {
    expect(folderLabel(['/repos/api', '/repos/web'])).toBe('api +1');
    expect(folderLabel(['/repos/api', '/repos/web', '/repos/infra'])).toBe('api +2');
  });
});

describe('deriveProjectName (#542)', () => {
  it('uses the first sentence of the prompt', () => {
    expect(deriveProjectName('Refactor the auth module. Then add tests.'))
      .toBe('Refactor the auth module');
  });

  it('uses only the first line of a multi-line prompt', () => {
    expect(deriveProjectName('Fix the login bug\n\nHere is the stack trace:'))
      .toBe('Fix the login bug');
  });

  it('collapses whitespace and strips wrapping punctuation', () => {
    expect(deriveProjectName('  "Add   dark   mode"  ')).toBe('Add dark mode');
    expect(deriveProjectName('## Migrate to vite 8')).toBe('Migrate to vite 8');
  });

  it('refuses slash commands — they describe the app, not the work', () => {
    expect(deriveProjectName('/clear')).toBeNull();
    expect(deriveProjectName('/folder Work')).toBeNull();
  });

  it('refuses empty or whitespace-only prompts', () => {
    expect(deriveProjectName('')).toBeNull();
    expect(deriveProjectName('   \n  ')).toBeNull();
    expect(deriveProjectName('***')).toBeNull();
  });

  it('truncates on a word boundary and marks the elision', () => {
    const long = 'Investigate why the streaming response occasionally drops the final token in long conversations';
    const out = deriveProjectName(long)!;
    expect(out.length).toBeLessThanOrEqual(MAX_PROJECT_NAME + 1); // +1 for the ellipsis
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/); // no dangling space before the ellipsis
  });
});

describe('isAutoFolderName (#542)', () => {
  it('treats a name matching any bound folder as auto-generated', () => {
    expect(isAutoFolderName('demo', ['/Users/me/demo'])).toBe(true);
    expect(isAutoFolderName('web', ['/repos/api', '/repos/web'])).toBe(true);
  });

  it('treats a user-chosen name as deliberate, so it is never overwritten', () => {
    expect(isAutoFolderName('Payments rewrite', ['/Users/me/demo'])).toBe(false);
  });

  it('treats an empty name as replaceable', () => {
    expect(isAutoFolderName('', ['/Users/me/demo'])).toBe(true);
  });
});

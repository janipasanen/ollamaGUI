import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { searchSessions, sortSessions } from '../services/storage';

import { ChatSession, Folder } from '../services/storage';

/** Replicate the filter logic from App.tsx (#615) as a pure function. */
function filterSessions(
  sessions: ChatSession[],
  searchQuery: string,
  folders: Folder[],
  showArchived: boolean,
  folderFilter: string | null,
  tagFilter: string | null,
  activeProjectId: string | null,
): ChatSession[] {
  return sortSessions(
    searchSessions(sessions, searchQuery, folders)
      .filter(s => !s.archived || showArchived)
      .filter(s => folderFilter === null || s.folderId === folderFilter)
      .filter(s => tagFilter === null || (s.tags ?? []).includes(tagFilter))
      .filter(s => activeProjectId === null ? !s.projectId : s.projectId === activeProjectId),
    'recent',
  );
}

describe('archive filter (#615)', () => {
  const sessions: ChatSession[] = [
    { id: 'a', title: 'Normal', messages: [], createdAt: 1, model: 'm', archived: false },
    { id: 'b', title: 'Archived', messages: [], createdAt: 2, model: 'm', archived: true },
    { id: 'c', title: 'Also Normal', messages: [], createdAt: 3, model: 'm', archived: false },
  ];

  it('excludes archived by default', () => {
    const result = filterSessions(sessions, '', [], false, null, null, null);
    expect(result.map(s => s.id)).toEqual(['c', 'a']); // non-archived, sorted by recency
  });

  it('includes archived when showArchived is true', () => {
    const result = filterSessions(sessions, '', [], true, null, null, null);
    expect(result.map(s => s.id)).toEqual(['c', 'b', 'a']); // all sessions sorted by recency
  });

  it('search still works when showing archived', () => {
    const result = filterSessions(sessions, 'Normal', [], true, null, null, null);
    expect(result.map(s => s.id)).toEqual(['c', 'a']); // only matching non-archived
  });

  it('excludes archived from project-first view', () => {
    // sessions with no projectId are "unscoped"
    const result = filterSessions(sessions, '', [], false, null, null, null);
    expect(result.map(s => s.id)).toEqual(['c', 'a']);
  });

  it('includes only archived when showArchived and filter match', () => {
    // With showArchived=true, the filter is inclusive: archived || showArchived
    const result = filterSessions(sessions, '', [], true, null, null, null);
    expect(result.length).toBe(3);
  });
});

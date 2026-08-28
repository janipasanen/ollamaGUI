import { describe, it, expect } from 'vitest';
import { workspaceLabel } from '../components/useWorkspacePicker';

describe('workspaceLabel', () => {
  it('returns "No folder" for null', () => {
    expect(workspaceLabel(null)).toBe('No folder');
  });

  it('returns the basename of a forward-slash path', () => {
    expect(workspaceLabel('/home/user/project')).toBe('project');
  });

  it('returns the basename of a backslash (Windows) path', () => {
    expect(workspaceLabel('C:\\Users\\jani\\work')).toBe('work');
  });

  it('ignores trailing slashes', () => {
    expect(workspaceLabel('/home/user/project/')).toBe('project');
  });

  it('treats an empty root as "No folder" (empty string is falsy)', () => {
    expect(workspaceLabel('')).toBe('No folder');
  });

  it('falls back to the full root when the basename is empty', () => {
    expect(workspaceLabel('/')).toBe('/');
  });
});

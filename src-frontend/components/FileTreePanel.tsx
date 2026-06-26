/**
 * FileTreePanel (#85, #81).
 *
 * A side-dock workspace file-tree. Reads the active workspace root from
 * fileTools/workspace state and lists directories via the Rust `list_dir`
 * command. Selecting a file emits an event so callers (e.g. App.tsx) can
 * insert it into the chat input as an @-mention or read it directly.
 *
 * The panel registers itself with panelRegistry (id 'files') at module load.
 */

import React, { useEffect, useState } from 'react';
import { panelRegistry } from './PanelShell';
import { listWorkspaceDir, getActiveRoot, openWorkspace, removeRecentWorkspace, loadWorkspaceState, type WorkspaceState } from '../services/workspace';
import { pickDirectory } from '../services/platform';
import type { DirEntry } from '../services/fileTools';

export interface FileTreePanelProps {
  dark: boolean;
}

export type FileTreeNode = DirEntry;

function fileIcon(entry: DirEntry): string {
  if (entry.is_dir) return '📁';
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
  if (['md', 'txt', 'json', 'yaml', 'yml', 'toml', 'xml'].includes(ext)) return '📄';
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'swift'].includes(ext)) return '⌨';
  if (['html', 'svg', 'css'].includes(ext)) return '🌐';
  return '📃';
}

function TreeNode({
  entry,
  depth,
  dark,
  root,
  onSelect,
  expanded,
  toggle,
}: {
  entry: DirEntry;
  depth: number;
  dark: boolean;
  root: string;
  onSelect: (entry: DirEntry) => void;
  expanded: Set<string>;
  toggle: (path: string) => void;
}): React.ReactElement {
  const isExpanded = expanded.has(entry.path);
  const [children, setChildren] = useState<DirEntry[]>([]);

  useEffect(() => {
    if (entry.is_dir && isExpanded) {
      listDirSafe(entry.path)
        .then(setChildren)
        .catch(() => setChildren([]));
    }
  }, [entry.path, entry.is_dir, isExpanded]);

  return (
    <div data-testid={`file-tree-node-${entry.path.replace(/[^a-zA-Z0-9]/g, '-')}`}>
      <button
        onClick={() => {
          if (entry.is_dir) toggle(entry.path);
          else onSelect(entry);
        }}
        className={`w-full flex items-center gap-1.5 px-2 py-1 text-xs text-left transition-colors ${dark ? 'hover:bg-zinc-800 text-zinc-300' : 'hover:bg-zinc-100 text-zinc-700'}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span className="select-none w-4 text-center">{entry.is_dir ? (isExpanded ? '▾' : '▸') : ''}</span>
        <span className="select-none">{fileIcon(entry)}</span>
        <span className="truncate">{entry.name}</span>
      </button>
      {entry.is_dir && isExpanded && (
        <div data-testid={`file-tree-children-${entry.path.replace(/[^a-zA-Z0-9]/g, '-')}`}>
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              dark={dark}
              root={root}
              onSelect={onSelect}
              expanded={expanded}
              toggle={toggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const _mocks = {
  listWorkspaceDir: null as ((path?: string) => Promise<DirEntry[]>) | null,
};

async function listDirSafe(path?: string): Promise<DirEntry[]> {
  if (_mocks.listWorkspaceDir) return _mocks.listWorkspaceDir(path);
  return listWorkspaceDir(path);
}

function FileTreePanel({ dark }: FileTreePanelProps): React.ReactElement {
  const [state, setState] = useState<WorkspaceState>(() => loadWorkspaceState());
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const root = state.root;

  const refresh = React.useCallback(async () => {
    if (!root) { setEntries([]); return; }
    try {
      const list = await listDirSafe(root);
      setEntries(list);
      setError(null);
    } catch (e) {
      setError(String(e));
      setEntries([]);
    }
  }, [root]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openFolder = async () => {
    const dir = await pickDirectory();
    if (!dir) return;
    await openWorkspace(dir);
    setState(loadWorkspaceState());
  };

  const toggle = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const onSelect = (entry: DirEntry) => {
    window.dispatchEvent(new CustomEvent('ollama-gui:select-file', { detail: { entry } }));
  };

  return (
    <div data-testid="file-tree-panel" className={`flex flex-col h-full ${dark ? 'bg-zinc-900 text-zinc-200' : 'bg-white text-zinc-700'}`}>
      <div className={`flex items-center justify-between px-3 py-2 border-b text-xs ${dark ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-200 bg-zinc-50'}`}>
        <span className="font-medium truncate">{root ? root.split(/[\\/]/).pop() ?? root : 'Workspace'}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { refresh(); }}
            aria-label="Refresh file tree"
            className={`text-xs px-2 py-0.5 rounded transition-colors ${dark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}
          >
            ↻
          </button>
          <button
            onClick={() => { void openFolder(); }}
            aria-label="Open workspace folder"
            className={`text-xs px-2 py-0.5 rounded transition-colors ${dark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'}`}
          >
            Open
          </button>
        </div>
      </div>

      {root === null && (
        <div className={`p-4 text-sm text-center ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>
          <p className="mb-3">No workspace open.</p>
          <button
            onClick={() => { void openFolder(); }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white"
          >
            Choose folder
          </button>
        </div>
      )}

      {root && error && (
        <div className={`p-3 text-xs ${dark ? 'text-red-400' : 'text-red-600'}`}>
          {error}
        </div>
      )}

      {root && (
        <div data-testid="file-tree-list" className="flex-1 overflow-auto py-1">
          {entries.length === 0 && !error && (
            <div className={`p-3 text-xs ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>Empty workspace.</div>
          )}
          {entries.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              dark={dark}
              root={root}
              onSelect={onSelect}
              expanded={expanded}
              toggle={toggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Exported so tests can register after mocking PanelShell. */
export function registerFileTreePanel(): void {
  (panelRegistry as any)?.register?.({
    id: 'files',
    title: 'Files',
    icon: '📁',
    dock: 'side',
    render: (dark: boolean) => <FileTreePanel dark={dark} />,
  });
}

export default FileTreePanel;

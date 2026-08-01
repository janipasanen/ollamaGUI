/**
 * Always-visible workspace indicator + folder picker (#481).
 *
 * Before this, the active workspace root was only legible if the user had
 * already opened the Files panel (closed by default), and changing it meant
 * digging through Settings -> Projects. The chip keeps the working directory
 * visible at a glance and one click from anywhere in the app.
 */

import React, { useRef, useState } from 'react';
import { useWorkspacePicker } from './useWorkspacePicker';
import { AnchoredMenu } from './AnchoredMenu';

export interface WorkspaceChipProps {
  dark: boolean;
}

export const WorkspaceChip: React.FC<WorkspaceChipProps> = ({ dark }) => {
  const ws = useWorkspacePicker();
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const itemCls = `w-full text-left text-xs px-3 py-1.5 truncate transition-colors ${
    dark ? 'text-zinc-300 hover:bg-zinc-700' : 'text-zinc-700 hover:bg-zinc-100'
  }`;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setMenuOpen(o => !o)}
        title={ws.root ?? 'No workspace folder open'}
        aria-label={ws.root ? `Workspace folder: ${ws.root}` : 'No workspace folder open'}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-testid="workspace-chip"
        className={`shrink-0 flex items-center gap-1.5 text-sm border rounded-md px-2 py-1 max-w-[14rem] transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          dark
            ? 'bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700'
            : 'bg-zinc-100 border-zinc-300 text-zinc-900 hover:bg-zinc-200'
        }`}
      >
        <span aria-hidden="true">📁</span>
        <span className={`truncate ${ws.root ? '' : dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
          {ws.label}
        </span>
      </button>

      <AnchoredMenu
        anchorRef={btnRef}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        dark={dark}
        align="left"
        ariaLabel="Workspace folder"
        className="min-w-[16rem] max-w-[24rem]"
      >
          <button
            role="menuitem"
            className={itemCls}
            disabled={ws.picking}
            onClick={() => { setMenuOpen(false); void ws.choose(); }}
          >
            {ws.picking ? 'Opening…' : 'Open folder…'}
          </button>

          {ws.recentRoots.length > 0 && (
            <>
              <div className={`px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                Recent
              </div>
              {ws.recentRoots.slice(0, 5).map(r => (
                <button
                  key={r}
                  role="menuitem"
                  title={r}
                  className={itemCls}
                  onClick={() => { setMenuOpen(false); void ws.openPath(r); }}
                >
                  {r}
                </button>
              ))}
            </>
          )}

          {ws.root && (
            <>
              <div className={`my-1 border-t ${dark ? 'border-zinc-700' : 'border-zinc-200'}`} />
              <button
                role="menuitem"
                className={`w-full text-left text-xs px-3 py-1.5 transition-colors ${
                  dark ? 'text-red-400 hover:bg-zinc-700' : 'text-red-600 hover:bg-zinc-100'
                }`}
                onClick={() => { setMenuOpen(false); ws.close(); }}
              >
                Close workspace
              </button>
            </>
          )}
      </AnchoredMenu>
    </>
  );
};

export default WorkspaceChip;

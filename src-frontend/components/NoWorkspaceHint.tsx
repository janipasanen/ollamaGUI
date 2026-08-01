/**
 * Inline "no workspace folder open" hint for agentic mode (#482).
 *
 * Without this, the requirement is only discovered reactively: file/git/search
 * tools fail mid-run with "No workspace root set — open a project folder
 * first." after the model has already burned iterations. This surfaces the
 * requirement before the first send, with the fix one click away.
 */

import React, { useState } from 'react';
import { useWorkspacePicker } from './useWorkspacePicker';

export interface NoWorkspaceHintProps {
  dark: boolean;
  /** Only shown while the agentic tool loop is enabled. */
  agentic: boolean;
}

export const NoWorkspaceHint: React.FC<NoWorkspaceHintProps> = ({ dark, agentic }) => {
  const ws = useWorkspacePicker();
  const [dismissed, setDismissed] = useState(false);

  if (!agentic || ws.root || dismissed) return null;

  return (
    <div
      data-testid="no-workspace-hint"
      className={`max-w-3xl mx-auto mb-2 flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${
        dark
          ? 'bg-amber-950/40 border-amber-900/60 text-amber-200'
          : 'bg-amber-50 border-amber-200 text-amber-800'
      }`}
    >
      <span aria-hidden="true">📁</span>
      <span className="flex-1">
        No project folder is open — file, search, and Git tools will not work until you choose one.
      </span>
      <button
        onClick={() => { void ws.choose(); }}
        disabled={ws.picking}
        className="shrink-0 px-2 py-1 rounded font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white transition-colors"
      >
        {ws.picking ? 'Opening…' : 'Open folder'}
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss workspace hint"
        className={`shrink-0 px-1 transition-colors ${dark ? 'text-amber-500 hover:text-amber-300' : 'text-amber-600 hover:text-amber-900'}`}
      >
        ✕
      </button>
    </div>
  );
};

export default NoWorkspaceHint;

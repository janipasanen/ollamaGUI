/**
 * Ambient project context at the top of the chat column (#543).
 *
 * Modelled on the Claude GUI: the project name, and directly beneath it the
 * working folder in a subdued filled chip. The chip is the SESSION's working
 * directory (#550): clicking it changes where this session's agent works,
 * without touching the project's own folder bindings.
 *
 * Renders nothing when no project is active, rather than showing a placeholder.
 */

import React from 'react';
import { folderLabel } from '../services/projectNaming';

export interface ProjectHeaderProps {
  /** Active project name, or null when none is active. */
  name: string | null;
  /** Every folder the session works in, primary (= session working dir) first. */
  roots: string[];
  dark: boolean;
  /** Invoked when the user clicks the folder chip to change the session's working directory. */
  onChangeWorkingDir?: () => void;
}

export const ProjectHeader: React.FC<ProjectHeaderProps> = ({ name, roots, dark, onChangeWorkingDir }) => {
  if (!name) return null;

  const label = folderLabel(roots);

  return (
    <div className="px-4 md:px-6 pt-3 pb-1 shrink-0" data-testid="project-header">
      <h1
        className={`text-sm font-semibold truncate ${dark ? 'text-zinc-100' : 'text-zinc-900'}`}
        title={name}
      >
        {name}
      </h1>
      {label && (
        <button
          type="button"
          data-testid="project-folder-chip"
          onClick={() => onChangeWorkingDir?.()}
          // Full path on hover; the chip itself stays compact so a deep path
          // cannot push the layout around.
          title={`${roots.join('\n')}\n\nClick to change this session's working folder`}
          aria-label="Change session working folder"
          className={`mt-1 inline-block max-w-full truncate rounded px-1.5 py-0.5 text-[11px] font-mono cursor-pointer transition-colors ${
            dark ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200' : 'bg-zinc-200 text-zinc-600 hover:bg-zinc-300 hover:text-zinc-800'
          }`}
        >
          {label}
        </button>
      )}
    </div>
  );
};

export default ProjectHeader;

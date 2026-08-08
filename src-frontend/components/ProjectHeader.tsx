/**
 * Ambient project context at the top of the chat column (#543).
 *
 * Modelled on the Claude GUI: the project name, and directly beneath it the
 * selected folder in a subdued filled chip. Before this the only indication of
 * the working directory was a dropdown chip lost among 18 header controls — it
 * read as a control rather than as context. When an agent is about to edit
 * files, "which folder am I pointed at" should be ambient, not something you go
 * looking for.
 *
 * Renders nothing when no project is active, rather than showing a placeholder.
 */

import React from 'react';
import { folderLabel } from '../services/projectNaming';

export interface ProjectHeaderProps {
  /** Active project name, or null when none is active. */
  name: string | null;
  /** Every folder bound to the project, primary first. */
  roots: string[];
  dark: boolean;
}

export const ProjectHeader: React.FC<ProjectHeaderProps> = ({ name, roots, dark }) => {
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
        <span
          data-testid="project-folder-chip"
          // Full path on hover; the chip itself stays compact so a deep path
          // cannot push the layout around.
          title={roots.join('\n')}
          className={`mt-1 inline-block max-w-full truncate rounded px-1.5 py-0.5 text-[11px] font-mono ${
            dark ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-200 text-zinc-600'
          }`}
        >
          {label}
        </span>
      )}
    </div>
  );
};

export default ProjectHeader;

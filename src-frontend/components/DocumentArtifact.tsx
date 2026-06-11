/**
 * DocumentArtifact (#145).
 *
 * A 'document' artifact represents a multi-format file (docx/xlsx/pptx/odt/pdf/
 * markdown/…) produced or edited by a document_create / document_edit /
 * convert_document op. Unlike the html/svg/code artifacts (which live entirely
 * in memory), a document artifact is backed by a real file on disk; this card
 * shows a text preview plus Open / Save (Export) actions that act on that path.
 *
 * It mirrors the artifact-panel styling in App.tsx and themes purely through
 * the `dark` ternary convention (no CSS variables).
 */

import React from 'react';

/** Shape of a document artifact pushed into the artifact panel. */
export interface DocumentArtifactData {
  kind: 'document';
  /** Workspace-relative path to the backing file. */
  path: string;
  /** Format tag, e.g. 'docx', 'pdf', 'pptx', 'markdown'. */
  format: string;
  /** Extracted plain-text / markdown preview of the document body. */
  previewText: string;
}

export interface DocumentArtifactProps {
  data: DocumentArtifactData;
  dark: boolean;
  /** Open the backing file (e.g. in the OS default app). */
  onOpen: (path: string) => void;
  /** Save / export the backing file elsewhere. */
  onExport: (path: string) => void;
}

/** Derive a display file name from a path. */
function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export default function DocumentArtifact({ data, dark, onOpen, onExport }: DocumentArtifactProps) {
  const name = fileNameOf(data.path);

  return (
    <div
      data-testid="document-artifact"
      className={`flex flex-col overflow-hidden h-full ${dark ? 'bg-zinc-900 text-zinc-200' : 'bg-white text-zinc-700'}`}
    >
      {/* Header: file name + format badge + actions */}
      <div
        className={`h-14 flex items-center justify-between px-4 shrink-0 border-b ${
          dark ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-200 bg-zinc-50'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            data-testid="document-format-badge"
            className={`text-xs font-mono px-2 py-0.5 rounded shrink-0 uppercase ${
              dark ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-200 text-zinc-600'
            }`}
          >
            {data.format}
          </span>
          <span
            className={`text-sm font-medium truncate ${dark ? 'text-zinc-200' : 'text-zinc-700'}`}
            title={data.path}
          >
            {name}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onOpen(data.path)}
            aria-label="Open document"
            title="Open"
            className={`text-xs px-3 py-1 rounded font-medium transition-colors ${
              dark ? 'border border-blue-600 text-blue-400 hover:bg-blue-600/20' : 'border border-blue-500 text-blue-600 hover:bg-blue-50'
            }`}
          >
            Open
          </button>
          <button
            onClick={() => onExport(data.path)}
            aria-label="Save document"
            title="Save / export to file"
            className="text-xs px-3 py-1 rounded font-semibold transition-colors bg-blue-600 hover:bg-blue-500 text-white"
          >
            Save
          </button>
        </div>
      </div>

      {/* Body: text preview. Rendered as a <pre> for now (markdown/plain text). */}
      <div className="flex-1 overflow-auto p-4">
        <pre
          data-testid="document-preview"
          className={`whitespace-pre-wrap break-words text-sm font-sans leading-relaxed ${
            dark ? 'text-zinc-300' : 'text-zinc-700'
          }`}
        >
          {data.previewText}
        </pre>
      </div>
    </div>
  );
}

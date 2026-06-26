import React, { useEffect, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { panelRegistry, openPanel } from './PanelShell';
import type { Artifact } from '../services/artifacts';
export type { Artifact };
import { exportArtifact } from '../services/artifacts';
import DocumentArtifact, { type DocumentArtifactData } from './DocumentArtifact';
export type { DocumentArtifactData } from './DocumentArtifact';

/** Either a detected code/HTML/SVG artifact or a document artifact. */
export type AnyArtifact = Artifact | DocumentArtifactData;

export interface ArtifactPanelProps {
  artifact: AnyArtifact | null;
  dark: boolean;
}

/**
 * Open a document (or any file path) with the system default application.
 * Degrades gracefully in browser/test mode where the Tauri plugin is absent.
 */
export async function openDocumentPath(path: string): Promise<void> {
  if (_mocks.openDocumentPath) {
    await _mocks.openDocumentPath(path);
    return;
  }
  try {
    const opener = await import('@tauri-apps/plugin-opener');
    if (typeof (opener as any).openPath === 'function') {
      await (opener as any).openPath(path);
    } else if (typeof (opener as any).open === 'function') {
      await (opener as any).open(path);
    }
  } catch (e) {
    console.warn(`[artifact] openDocumentPath unavailable: ${e}`);
  }
}

/**
 * Export a document to a user-chosen location.
 * Uses the Tauri save dialog and the existing `run_cli` command to copy the
 * file, so it works without adding a new backend command.
 */
export async function exportDocumentPath(path: string): Promise<void> {
  if (_mocks.exportDocumentPath) {
    await _mocks.exportDocumentPath(path);
    return;
  }
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const dest = await save({ defaultPath: path.split(/[\\/]/).pop() ?? 'document' });
    if (!dest) return;

    const { invoke } = await import('@tauri-apps/api/core');
    const command = navigator.platform.startsWith('Win')
      ? `copy "${path}" "${dest}"`
      : `cp "${path}" "${dest}"`;
    await invoke('run_cli', { command });
  } catch (e) {
    console.warn(`[artifact] exportDocumentPath unavailable: ${e}`);
  }
}

/** Test seam for document actions. */
export const _mocks = {
  openDocumentPath: null as ((path: string) => Promise<void> | void) | null,
  exportDocumentPath: null as ((path: string) => Promise<void> | void) | null,
};

function isDocumentArtifact(a: AnyArtifact | null): a is DocumentArtifactData {
  return !!a && (a as DocumentArtifactData).kind === 'document';
}

function ArtifactPanel({ artifact, dark }: ArtifactPanelProps): React.ReactElement | null {
  const [artifactTab, setArtifactTab] = useState<'preview' | 'code'>('preview');
  const [artifactCopied, setArtifactCopied] = useState(false);

  useEffect(() => {
    if (!artifact || isDocumentArtifact(artifact)) return;
    setArtifactTab(artifact.kind === 'html' || artifact.kind === 'svg' ? 'preview' : 'code');
  }, [artifact]);

  if (!artifact) {
    return (
      <div className={`h-full flex items-center justify-center text-sm ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>
        No artifact selected.
      </div>
    );
  }

  if (isDocumentArtifact(artifact)) {
    return (
      <DocumentArtifact
        data={artifact}
        dark={dark}
        onOpen={openDocumentPath}
        onExport={exportDocumentPath}
      />
    );
  }

  return (
    <div data-testid="artifact-panel" className={`flex flex-col h-full ${dark ? 'bg-zinc-900 text-zinc-200' : 'bg-white text-zinc-700'}`}>
      <div className={`h-14 flex items-center justify-between px-4 shrink-0 border-b ${dark ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-200 bg-zinc-50'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-xs font-mono px-2 py-0.5 rounded shrink-0 ${dark ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-200 text-zinc-600'}`}>{artifact.language}</span>
          <span className={`text-sm font-medium truncate ${dark ? 'text-zinc-200' : 'text-zinc-700'}`}>Artifact</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {(artifact.kind === 'html' || artifact.kind === 'svg') && (
            <div className={`flex rounded-lg overflow-hidden border text-xs mr-1 ${dark ? 'border-zinc-700' : 'border-zinc-200'}`}>
              <button onClick={() => setArtifactTab('preview')} className={`px-2 py-1 transition-colors ${artifactTab === 'preview' ? (dark ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-200 text-zinc-800') : (dark ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-500 hover:bg-zinc-100')}`}>Preview</button>
              <button onClick={() => setArtifactTab('code')} className={`px-2 py-1 transition-colors ${artifactTab === 'code' ? (dark ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-200 text-zinc-800') : (dark ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-500 hover:bg-zinc-100')}`}>Code</button>
            </div>
          )}
          <button
            onClick={() => {
              navigator.clipboard.writeText(artifact.code);
              setArtifactCopied(true);
              setTimeout(() => setArtifactCopied(false), 2000);
            }}
            aria-label="Copy artifact code"
            title="Copy"
            className={`text-xs px-2 py-1 rounded transition-colors ${artifactCopied ? 'text-green-400' : (dark ? 'text-zinc-400 hover:bg-zinc-700' : 'text-zinc-500 hover:bg-zinc-100')}`}
          >{artifactCopied ? '✓' : '⎘'}</button>
          <button
            onClick={() => exportArtifact(artifact)}
            aria-label="Export artifact to file"
            title="Export to file"
            className={`text-xs px-2 py-1 rounded transition-colors ${dark ? 'text-zinc-400 hover:bg-zinc-700' : 'text-zinc-500 hover:bg-zinc-100'}`}
          >↓</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {(artifact.kind === 'html' || artifact.kind === 'svg') && artifactTab === 'preview' ? (
          <iframe srcDoc={artifact.code} title="Artifact preview" sandbox="allow-scripts" className="w-full h-full border-0 bg-white" />
        ) : (
          <div className="p-2">
            <SyntaxHighlighter style={dark ? vscDarkPlus : oneLight} language={artifact.language} PreTag="div" customStyle={{ margin: 0, borderRadius: '0.5rem', fontSize: '0.75rem' }}>
              {artifact.code}
            </SyntaxHighlighter>
          </div>
        )}
      </div>
    </div>
  );
}

function ArtifactPanelRoot({ dark }: { dark: boolean }): React.ReactElement {
  const [artifact, setArtifact] = useState<AnyArtifact | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { artifact: AnyArtifact } | undefined;
      if (detail?.artifact) setArtifact(detail.artifact);
    };
    window.addEventListener('ollama-gui:show-artifact' as any, handler);
    return () => window.removeEventListener('ollama-gui:show-artifact' as any, handler);
  }, []);

  return <ArtifactPanel artifact={artifact} dark={dark} />;
}

// Register once at module load so the panel is available to the shell
// regardless of where (or whether) the component is rendered in the tree.
(panelRegistry as any)?.register?.({
  id: 'artifacts',
  title: 'Artifacts',
  icon: '🖼',
  render: (d: boolean) => <ArtifactPanelRoot dark={d} />,
});

/** Show an artifact in the side dock. Opens the panel if it is closed. */
export function showArtifact(artifact: AnyArtifact): void {
  window.dispatchEvent(new CustomEvent('ollama-gui:show-artifact', { detail: { artifact } }));
  openPanel('artifacts');
}

export default ArtifactPanel;

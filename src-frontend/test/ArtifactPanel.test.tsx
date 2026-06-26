import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

const { registerSpy, openPanelSpy, closePanelSpy } = vi.hoisted(() => ({
  registerSpy: vi.fn(),
  openPanelSpy: vi.fn(),
  closePanelSpy: vi.fn(),
}));

vi.mock('../components/PanelShell', () => ({
  panelRegistry: {
    register: (...args: any[]) => registerSpy(...args),
    unregister: vi.fn(),
    list: vi.fn(() => []),
    get: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  },
  openPanel: (...args: any[]) => openPanelSpy(...args),
  closePanel: (...args: any[]) => closePanelSpy(...args),
  togglePanel: vi.fn(),
  isPanelOpen: vi.fn(),
}));

// Import AFTER the PanelShell mock so the module-level registration is captured.
import ArtifactPanel, { showArtifact, _mocks } from '../components/ArtifactPanel';
import type { Artifact, DocumentArtifactData } from '../components/ArtifactPanel';

const sampleCodeArtifact: Artifact = {
  id: 'a1',
  kind: 'code',
  language: 'typescript',
  code: 'const x = 1;',
  title: 'snippet',
  createdAt: Date.now(),
};

const sampleHtmlArtifact: Artifact = {
  id: 'a2',
  kind: 'html',
  language: 'html',
  code: '<h1>Hello</h1>',
  title: 'hello',
  createdAt: Date.now(),
};

const sampleDocArtifact: DocumentArtifactData = {
  kind: 'document',
  path: 'reports/q3/summary.docx',
  format: 'docx',
  previewText: 'Quarterly Summary',
};

describe('ArtifactPanel (#99, #145)', () => {
  beforeEach(() => {
    // Module-level registration happens once at import time; do not clear it.
    openPanelSpy.mockClear();
    closePanelSpy.mockClear();
    _mocks.openDocumentPath = null;
    _mocks.exportDocumentPath = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('registers itself with panelRegistry (id "artifacts") at module load', () => {
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy.mock.calls[0][0]).toMatchObject({ id: 'artifacts', title: 'Artifacts' });
  });

  it('showArtifact dispatches a custom event and opens the artifacts panel', () => {
    const eventSpy = vi.fn();
    window.addEventListener('ollama-gui:show-artifact' as any, eventSpy);
    showArtifact(sampleCodeArtifact);
    window.removeEventListener('ollama-gui:show-artifact' as any, eventSpy);

    expect(eventSpy).toHaveBeenCalledTimes(1);
    expect((eventSpy.mock.calls[0][0] as CustomEvent).detail.artifact).toEqual(sampleCodeArtifact);
    expect(openPanelSpy).toHaveBeenCalledWith('artifacts');
  });

  it('renders a code artifact body in the right dock via the registered render fn', () => {
    const registered = registerSpy.mock.calls[0][0];
    const { rerender } = render(registered.render(false));

    // Initially no artifact selected.
    expect(screen.getByText('No artifact selected.')).toBeInTheDocument();

    act(() => { showArtifact(sampleCodeArtifact); });
    rerender(registered.render(false));

    expect(screen.getByTestId('artifact-panel')).toBeInTheDocument();
    expect(screen.getByText('typescript')).toBeInTheDocument();
    expect(screen.getByTestId('artifact-panel').textContent).toContain('const x = 1;');
  });

  it('renders an HTML artifact preview tab by default', () => {
    const registered = registerSpy.mock.calls[0][0];
    const { rerender } = render(registered.render(false));

    act(() => { showArtifact(sampleHtmlArtifact); });
    rerender(registered.render(false));

    expect(screen.getByTitle('Artifact preview')).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.getByText('Code')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Code'));
    expect(screen.getByText(/Hello/)).toBeInTheDocument();
  });

  it('renders a document artifact when showArtifact receives one', () => {
    const registered = registerSpy.mock.calls[0][0];
    const { rerender } = render(registered.render(false));

    act(() => { showArtifact(sampleDocArtifact); });
    rerender(registered.render(false));

    expect(screen.getByTestId('document-artifact')).toBeInTheDocument();
    expect(screen.getByTestId('document-format-badge').textContent).toBe('docx');
    expect(screen.getByText('summary.docx')).toBeInTheDocument();
    expect(screen.getByText('Quarterly Summary')).toBeInTheDocument();
  });

  it('calls the opener callback when Open is clicked on a document artifact', () => {
    const openMock = vi.fn();
    _mocks.openDocumentPath = openMock;

    const registered = registerSpy.mock.calls[0][0];
    const { rerender } = render(registered.render(false));
    act(() => { showArtifact(sampleDocArtifact); });
    rerender(registered.render(false));

    fireEvent.click(screen.getByLabelText('Open document'));
    expect(openMock).toHaveBeenCalledWith('reports/q3/summary.docx');
  });

  it('calls the export callback when Save is clicked on a document artifact', () => {
    const exportMock = vi.fn();
    _mocks.exportDocumentPath = exportMock;

    const registered = registerSpy.mock.calls[0][0];
    const { rerender } = render(registered.render(false));
    act(() => { showArtifact(sampleDocArtifact); });
    rerender(registered.render(false));

    fireEvent.click(screen.getByLabelText('Save document'));
    expect(exportMock).toHaveBeenCalledWith('reports/q3/summary.docx');
  });
});

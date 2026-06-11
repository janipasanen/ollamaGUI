import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DocumentArtifact, {
  type DocumentArtifactData,
} from '../components/DocumentArtifact';
import LibreOfficeOnboarding from '../components/LibreOfficeOnboarding';
import {
  loadLoState, saveLoState, markDismissed, setLoPath, needsOnboarding,
  _store, type StorageShim,
} from '../services/libreOfficeOnboarding';

// In-memory storage shim so the service tests don't depend on jsdom localStorage.
function memStore(): StorageShim {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => { map.set(k, v); },
  };
}

const sampleDoc: DocumentArtifactData = {
  kind: 'document',
  path: 'reports/q3/summary.docx',
  format: 'docx',
  previewText: 'Quarterly Summary\n\nRevenue grew by 12% this quarter.',
};

// ── DocumentArtifact ──────────────────────────────────────────────────────────

describe('DocumentArtifact (#145)', () => {
  it('renders the preview text', () => {
    render(<DocumentArtifact data={sampleDoc} dark={false} onOpen={() => {}} onExport={() => {}} />);
    expect(screen.getByTestId('document-preview').textContent)
      .toContain('Revenue grew by 12% this quarter.');
  });

  it('renders the format badge', () => {
    render(<DocumentArtifact data={sampleDoc} dark={false} onOpen={() => {}} onExport={() => {}} />);
    expect(screen.getByTestId('document-format-badge').textContent).toBe('docx');
  });

  it('renders the file name derived from the path', () => {
    render(<DocumentArtifact data={sampleDoc} dark={false} onOpen={() => {}} onExport={() => {}} />);
    expect(screen.getByText('summary.docx')).toBeInTheDocument();
  });

  it('calls onOpen with the path when Open is clicked', () => {
    const onOpen = vi.fn();
    render(<DocumentArtifact data={sampleDoc} dark={false} onOpen={onOpen} onExport={() => {}} />);
    fireEvent.click(screen.getByLabelText('Open document'));
    expect(onOpen).toHaveBeenCalledWith('reports/q3/summary.docx');
  });

  it('calls onExport with the path when Save is clicked', () => {
    const onExport = vi.fn();
    render(<DocumentArtifact data={sampleDoc} dark={false} onOpen={() => {}} onExport={onExport} />);
    fireEvent.click(screen.getByLabelText('Save document'));
    expect(onExport).toHaveBeenCalledWith('reports/q3/summary.docx');
  });

  it('renders in dark mode without crashing', () => {
    render(<DocumentArtifact data={sampleDoc} dark={true} onOpen={() => {}} onExport={() => {}} />);
    expect(screen.getByTestId('document-artifact')).toBeInTheDocument();
  });
});

// ── LibreOfficeOnboarding ─────────────────────────────────────────────────────

describe('LibreOfficeOnboarding (#145)', () => {
  it('renders null when open is false', () => {
    const { container } = render(
      <LibreOfficeOnboarding
        open={false} dark={false}
        onDetect={() => {}} onOpenDownload={() => {}} onDismiss={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the three action buttons when open', () => {
    render(
      <LibreOfficeOnboarding
        open={true} dark={false}
        onDetect={() => {}} onOpenDownload={() => {}} onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('Detect existing install')).toBeInTheDocument();
    expect(screen.getByText('Open download page')).toBeInTheDocument();
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
  });

  it('calls onDismiss when Dismiss is clicked', () => {
    const onDismiss = vi.fn();
    render(
      <LibreOfficeOnboarding
        open={true} dark={true}
        onDetect={() => {}} onOpenDownload={() => {}} onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('calls onDetect and onOpenDownload from their buttons', () => {
    const onDetect = vi.fn();
    const onOpenDownload = vi.fn();
    render(
      <LibreOfficeOnboarding
        open={true} dark={false}
        onDetect={onDetect} onOpenDownload={onOpenDownload} onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Detect existing install'));
    fireEvent.click(screen.getByText('Open download page'));
    expect(onDetect).toHaveBeenCalledOnce();
    expect(onOpenDownload).toHaveBeenCalledOnce();
  });
});

// ── libreOfficeOnboarding service ─────────────────────────────────────────────

describe('libreOfficeOnboarding state (#145)', () => {
  beforeEach(() => { _store.value = memStore(); });

  it('loadLoState returns a fresh default when nothing stored', () => {
    expect(loadLoState()).toEqual({ dismissed: false });
  });

  it('saveLoState + loadLoState round-trips path and dismissed', () => {
    saveLoState({ dismissed: true, path: '/usr/bin/soffice' });
    expect(loadLoState()).toEqual({ dismissed: true, path: '/usr/bin/soffice' });
  });

  it('setLoPath records the binary path without dismissing', () => {
    const s = setLoPath('/opt/libreoffice/soffice');
    expect(s.path).toBe('/opt/libreoffice/soffice');
    expect(s.dismissed).toBe(false);
    expect(loadLoState().path).toBe('/opt/libreoffice/soffice');
  });

  it('markDismissed sets dismissed true and persists', () => {
    markDismissed();
    expect(loadLoState().dismissed).toBe(true);
  });

  it('needsOnboarding is true when unavailable and not dismissed', () => {
    expect(needsOnboarding(false)).toBe(true);
  });

  it('needsOnboarding is false when the engine is available', () => {
    expect(needsOnboarding(true)).toBe(false);
  });

  it('needsOnboarding is false after markDismissed', () => {
    markDismissed();
    expect(needsOnboarding(false)).toBe(false);
  });
});

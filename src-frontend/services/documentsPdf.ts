/**
 * PDF create + extract service (#143).
 *
 * Thin wrappers over the Rust `document_pdf_info` / `document_pdf_merge` /
 * `document_pdf_split` Tauri commands, plus a `readPdfText` convenience that
 * reuses the existing `document_read` command (which already shells out to
 * `pdftotext` for `.pdf` inputs).
 *
 * `pdfInfo` is fully wired (page count + has_text via Poppler). `pdfMerge` and
 * `pdfSplit` reach commands whose Rust bodies are DEFERRED until the `lopdf`
 * crate is approved — calling them today rejects with a clear "deferred"
 * message, but the client surface is stable so callers can be written now.
 */

import type { DocumentContent } from './documentTools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of probing a PDF: page count and whether it has extractable text. */
export interface PdfInfo {
  /** Number of pages; 0 when no PDF tool (Poppler) is installed. */
  pages: number;
  /** True when the PDF yields non-whitespace text (i.e. not a pure scan). */
  has_text: boolean;
}

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------

export const _mocks = {
  invoke: null as ((cmd: string, args: Record<string, unknown>) => Promise<unknown>) | null,
};

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (_mocks.invoke) return _mocks.invoke(cmd, args) as Promise<T>;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Probe a PDF for its page count and whether it contains extractable text.
 * Requires Poppler (`pdfinfo` / `pdftotext`) on the host; returns
 * `{ pages: 0, has_text: false }` if those tools are absent.
 */
export async function pdfInfo(path: string): Promise<PdfInfo> {
  return tauriInvoke<PdfInfo>('document_pdf_info', { path });
}

/** Merge multiple PDFs (in order) into a single output file via lopdf. */
export async function pdfMerge(paths: string[], out: string): Promise<void> {
  return tauriInvoke<void>('document_pdf_merge', { paths, out });
}

/**
 * Split a PDF into multiple files by page ranges (e.g. `"1-3,5"`).
 * Resolves to the list of written file paths.
 */
export async function pdfSplit(path: string, ranges: string, outDir: string): Promise<string[]> {
  return tauriInvoke<string[]>('document_pdf_split', { path, ranges, outDir });
}

/** Extract text from a PDF (bundled, no external tool) via lopdf. */
export async function pdfExtract(path: string): Promise<string> {
  return tauriInvoke<string>('document_pdf_extract', { path });
}

/** Generate a text PDF at `path` from a plain-text / markdown spec. */
export async function pdfCreate(path: string, text: string): Promise<void> {
  return tauriInvoke<void>('document_pdf_create', { path, text });
}

/**
 * Extract plain text from a PDF by reusing the existing `document_read`
 * command (which routes `.pdf` files through `pdftotext`).
 */
export async function readPdfText(path: string): Promise<DocumentContent> {
  return tauriInvoke<DocumentContent>('document_read', { path });
}

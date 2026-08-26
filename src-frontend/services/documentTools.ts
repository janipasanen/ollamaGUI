/**
 * Multi-format document I/O service (#139-#145).
 *
 * Wraps the Rust document_read / document_convert / document_create /
 * document_formats Tauri commands. Registers agent tools in toolRegistry,
 * gated by diff-review approval for write operations.
 *
 * Supported read formats: docx, xlsx, pptx, odt/ods/odp, pdf, markdown, text.
 * Conversion requires Pandoc to be installed on the host machine.
 */
import { pdfInfo, pdfMerge, pdfSplit, pdfExtract, pdfCreate, type PdfInfo } from './documentsPdf';
import { editDocument, templateFillDocument, editOdfDocument } from './documents';


export interface DocumentContent {
  text: string;
  format: string;
  title: string | null;
  word_count: number;
}

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------

export const _mocks = {
  invoke: null as ((cmd: string, args: Record<string, unknown>) => Promise<unknown>) | null,
};

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (_mocks.invoke) return _mocks.invoke(cmd, args) as Promise<T>;
  const { invoke } = await import('@tauri-apps/api');
  return invoke<T>(cmd, args);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Read and extract plain text from a document file. */
export async function readDocument(path: string): Promise<DocumentContent> {
  return tauriInvoke<DocumentContent>('document_read', { path });
}

/**
 * Convert a document from one format to another using Pandoc.
 * Requires Pandoc to be installed on the host.
 */
export async function convertDocument(src: string, dest: string): Promise<void> {
  return tauriInvoke<void>('document_convert', { src, dest });
}

/**
 * Create a new document file from markdown/text content.
 * For non-text formats (docx, pdf, etc.) Pandoc is used.
 */
export async function createDocument(path: string, format: string, content: string): Promise<void> {
  return tauriInvoke<void>('document_create', { path, format, content });
}

/** Return the list of supported document formats. */
export async function documentFormats(): Promise<string[]> {
  return tauriInvoke<string[]>('document_formats', {});
}

/** Detect document format from file extension (client-side mirror of Rust logic). */
export function detectDocumentFormat(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.pptx')) return 'pptx';
  if (lower.endsWith('.odt') || lower.endsWith('.ods') || lower.endsWith('.odp')) return 'odt';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  return 'text';
}

// ---------------------------------------------------------------------------
// Agent tool registration (#144)
// ---------------------------------------------------------------------------

import { toolRegistry } from './tools';

export function registerDocumentTools(): void {
  toolRegistry.registerTool({
    name: 'document_read',
    description: 'Read and extract text from a document file (docx, xlsx, pptx, odt, pdf, md, txt).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the document file (relative to workspace root)' },
      },
      required: ['path'],
    },
    readOnly: true,
    execute: async (p) => readDocument(p.path as string),
  });

  toolRegistry.registerTool({
    name: 'document_convert',
    description: 'Convert a document from one format to another using Pandoc (must be installed).',
    parameters: {
      type: 'object',
      properties: {
        src: { type: 'string', description: 'Source file path' },
        dest: { type: 'string', description: 'Destination file path (extension determines format)' },
      },
      required: ['src', 'dest'],
    },
    execute: async (p) => {
      await convertDocument(p.src as string, p.dest as string);
      return { converted: true, dest: p.dest };
    },
  });

  toolRegistry.registerTool({
    name: 'document_create',
    description: 'Create a new document from markdown/text content. Non-text formats require Pandoc.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Destination file path' },
        format: { type: 'string', description: 'Format: md, txt, docx, pdf, etc.' },
        content: { type: 'string', description: 'Markdown or plain text content' },
      },
      required: ['path', 'format', 'content'],
    },
    execute: async (p) => {
      await createDocument(p.path as string, p.format as string, p.content as string);
      return { created: true, path: p.path };
    },
  });

  toolRegistry.registerTool({
    name: 'document_formats',
    description: 'List document formats supported by the read/create/convert tools.',
    parameters: { type: 'object', properties: {} },
    readOnly: true,
    execute: async () => ({ formats: await documentFormats() }),
  });

  // PDF tools (#218) — wire documentsPdf into the agent tool registry.
  toolRegistry.registerTool({
    name: 'pdf_info',
    description: 'Probe a PDF for its page count and whether it has extractable text.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path to the PDF file' } }, required: ['path'] },
    readOnly: true,
    execute: async (p) => ({ info: await pdfInfo(p.path as string) }),
  });

  toolRegistry.registerTool({
    name: 'pdf_merge',
    description: 'Merge multiple PDFs (in order) into a single output file.',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'PDF file paths to merge, in order' },
        out: { type: 'string', description: 'Destination output PDF path' },
      },
      required: ['paths', 'out'],
    },
    execute: async (p) => { await pdfMerge(p.paths as string[], p.out as string); return { merged: true, out: p.out }; },
  });

  toolRegistry.registerTool({
    name: 'pdf_split',
    description: 'Split a PDF into multiple files by page ranges (e.g. "1-3,5").',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Source PDF path' },
        ranges: { type: 'string', description: 'Page ranges, e.g. "1-3,5"' },
        outDir: { type: 'string', description: 'Directory to write the split PDFs' },
      },
      required: ['path', 'ranges', 'outDir'],
    },
    execute: async (p) => ({ files: await pdfSplit(p.path as string, p.ranges as string, p.outDir as string) }),
  });

  toolRegistry.registerTool({
    name: 'pdf_extract',
    description: 'Extract plain text from a PDF (bundled, no external tool).',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path to the PDF file' } }, required: ['path'] },
    readOnly: true,
    execute: async (p) => ({ text: await pdfExtract(p.path as string) }),
  });

  toolRegistry.registerTool({
    name: 'pdf_create',
    description: 'Generate a text PDF at a path from plain-text / markdown content.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Destination output PDF path' }, text: { type: 'string', description: 'Plain-text or markdown content' } },
      required: ['path', 'text'],
    },
    execute: async (p) => { await pdfCreate(p.path as string, p.text as string); return { created: true, path: p.path }; },
  });

  // Office/ODF surgical edit tools (#222) — wire the document_edit /
  // document_odf_edit Rust commands (previously dead backend) into the agent.
  toolRegistry.registerTool({
    name: 'document_edit',
    description: 'Surgically find/replace text in an OOXML document (.docx/.xlsx/.pptx) in place.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the .docx/.xlsx/.pptx file' },
        find: { type: 'string', description: 'Exact text to find (must be a unique, non-fragmented run)' },
        replace: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'find', 'replace'],
    },
    execute: async (p) => editDocument(p.path as string, p.find as string, p.replace as string),
  });

  toolRegistry.registerTool({
    name: 'document_template_fill',
    description: 'Template-fill an OOXML document (.docx/.xlsx/.pptx) in place, substituting every {{key}} placeholder with its value.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the template file' },
        data: {
          type: 'object',
          description: 'Map of placeholder key (without braces) to replacement value',
        },
      },
      required: ['path', 'data'],
    },
    execute: async (p) => templateFillDocument(p.path as string, (p.data as Record<string, string>) ?? {}),
  });

  toolRegistry.registerTool({
    name: 'document_odf_edit',
    description: 'Surgically find/replace text in an OpenDocument file (.odt/.ods/.odp) in place.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the .odt/.ods/.odp file' },
        find: { type: 'string', description: 'Exact text to find (must be a unique, non-fragmented run)' },
        replace: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'find', 'replace'],
    },
    execute: async (p) => editOdfDocument(p.path as string, p.find as string, p.replace as string),
  });
}

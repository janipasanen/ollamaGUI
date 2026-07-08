import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readDocument,
  convertDocument,
  createDocument,
  documentFormats,
  detectDocumentFormat,
  registerDocumentTools,
  type DocumentContent,
  _mocks,
} from '../services/documentTools';
import * as pdfClient from '../services/documentsPdf';
import * as docsClient from '../services/documents';

beforeEach(() => {
  _mocks.invoke = null;
  pdfClient._mocks.invoke = null;
  docsClient._mocks.invoke = null;
});

afterEach(() => {
  _mocks.invoke = null;
  pdfClient._mocks.invoke = null;
  docsClient._mocks.invoke = null;
});

// ── readDocument ───────────────────────────────────────────────────────────────

describe('readDocument (#139)', () => {
  it('returns text and metadata for a docx file', async () => {
    _mocks.invoke = async () => ({
      text: 'Hello world from Word.',
      format: 'docx',
      title: null,
      word_count: 4,
    });
    const result = await readDocument('report.docx');
    expect(result.text).toBe('Hello world from Word.');
    expect(result.format).toBe('docx');
    expect(result.word_count).toBe(4);
  });

  it('calls document_read command with path', async () => {
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (_cmd, args) => {
      capturedArgs = args;
      return { text: '', format: 'xlsx', title: null, word_count: 0 };
    };
    await readDocument('/workspace/data.xlsx');
    expect(capturedArgs.path).toBe('/workspace/data.xlsx');
  });

  it('returns empty text for empty document', async () => {
    _mocks.invoke = async () => ({ text: '', format: 'txt', title: null, word_count: 0 });
    const result = await readDocument('empty.txt');
    expect(result.text).toBe('');
    expect(result.word_count).toBe(0);
  });

  it('returns pptx format for presentation', async () => {
    _mocks.invoke = async () => ({
      text: 'Slide 1 title\nSlide 1 content',
      format: 'pptx',
      title: null,
      word_count: 5,
    });
    const result = await readDocument('deck.pptx');
    expect(result.format).toBe('pptx');
    expect(result.text).toContain('Slide 1');
  });
});

// ── convertDocument ────────────────────────────────────────────────────────────

describe('convertDocument (#140)', () => {
  it('calls document_convert with src and dest', async () => {
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (_cmd, args) => { capturedArgs = args; return undefined; };
    await convertDocument('doc.md', 'doc.docx');
    expect(capturedArgs.src).toBe('doc.md');
    expect(capturedArgs.dest).toBe('doc.docx');
  });

  it('calls document_convert command', async () => {
    let capturedCmd = '';
    _mocks.invoke = async (cmd, _args) => { capturedCmd = cmd; return undefined; };
    await convertDocument('a.md', 'b.pdf');
    expect(capturedCmd).toBe('document_convert');
  });

  it('resolves without error on success', async () => {
    _mocks.invoke = async () => undefined;
    await expect(convertDocument('in.md', 'out.docx')).resolves.toBeUndefined();
  });
});

// ── createDocument ─────────────────────────────────────────────────────────────

describe('createDocument (#141)', () => {
  it('calls document_create with path, format, content', async () => {
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (_cmd, args) => { capturedArgs = args; return undefined; };
    await createDocument('report.docx', 'docx', '# Title\nContent here.');
    expect(capturedArgs.path).toBe('report.docx');
    expect(capturedArgs.format).toBe('docx');
    expect(capturedArgs.content).toBe('# Title\nContent here.');
  });

  it('calls document_create command', async () => {
    let capturedCmd = '';
    _mocks.invoke = async (cmd, _args) => { capturedCmd = cmd; return undefined; };
    await createDocument('note.md', 'md', '# Note');
    expect(capturedCmd).toBe('document_create');
  });
});

// ── documentFormats ────────────────────────────────────────────────────────────

describe('documentFormats (#139)', () => {
  it('returns list of supported formats', async () => {
    _mocks.invoke = async () => ['docx', 'xlsx', 'pptx', 'odt', 'pdf', 'markdown', 'text'];
    const formats = await documentFormats();
    expect(formats).toContain('docx');
    expect(formats).toContain('pdf');
    expect(formats.length).toBeGreaterThan(3);
  });

  it('calls document_formats command', async () => {
    let capturedCmd = '';
    _mocks.invoke = async (cmd, _args) => { capturedCmd = cmd; return []; };
    await documentFormats();
    expect(capturedCmd).toBe('document_formats');
  });
});

// ── detectDocumentFormat ───────────────────────────────────────────────────────

describe('detectDocumentFormat (#139)', () => {
  it('detects docx', () => { expect(detectDocumentFormat('report.docx')).toBe('docx'); });
  it('detects xlsx', () => { expect(detectDocumentFormat('data.xlsx')).toBe('xlsx'); });
  it('detects pptx', () => { expect(detectDocumentFormat('deck.pptx')).toBe('pptx'); });
  it('detects odt', () => { expect(detectDocumentFormat('doc.odt')).toBe('odt'); });
  it('detects pdf', () => { expect(detectDocumentFormat('manual.pdf')).toBe('pdf'); });
  it('detects markdown', () => { expect(detectDocumentFormat('README.md')).toBe('markdown'); });
  it('falls back to text for unknown extensions', () => {
    expect(detectDocumentFormat('data.csv')).toBe('text');
  });
  it('is case-insensitive', () => {
    expect(detectDocumentFormat('REPORT.DOCX')).toBe('docx');
  });
});

// ── registerDocumentTools (#144) ───────────────────────────────────────────────

describe('registerDocumentTools (#144)', () => {
  it('registers all four document tools', async () => {
    const { toolRegistry } = await import('../services/tools');
    registerDocumentTools();
    expect(toolRegistry.getTool('document_read')).toBeDefined();
    expect(toolRegistry.getTool('document_convert')).toBeDefined();
    expect(toolRegistry.getTool('document_create')).toBeDefined();
    expect(toolRegistry.getTool('document_formats')).toBeDefined();
  });

  it('registers the five PDF tools (#218)', async () => {
    const { toolRegistry } = await import('../services/tools');
    registerDocumentTools();
    for (const name of ['pdf_info', 'pdf_merge', 'pdf_split', 'pdf_extract', 'pdf_create']) {
      expect(toolRegistry.getTool(name)).toBeDefined();
    }
  });

  it('document_read is read-only', async () => {
    const { toolRegistry } = await import('../services/tools');
    registerDocumentTools();
    expect(toolRegistry.getTool('document_read')?.readOnly).toBe(true);
  });

  it('document_read tool delegates to readDocument', async () => {
    const { toolRegistry } = await import('../services/tools');
    _mocks.invoke = async () => ({ text: 'sample', format: 'docx', title: null, word_count: 1 });
    registerDocumentTools();
    const tool = toolRegistry.getTool('document_read');
    const result = await tool!.execute({ path: 'sample.docx' });
    expect((result as DocumentContent).text).toBe('sample');
  });

  it('pdf_info tool delegates to pdfInfo and is read-only', async () => {
    const { toolRegistry } = await import('../services/tools');
    let captured = '';
    pdfClient._mocks.invoke = async (cmd: string, args: Record<string, unknown>) => {
      captured = cmd;
      expect(args.path).toBe('a.pdf');
      return { pages: 3, has_text: true };
    };
    registerDocumentTools();
    const tool = toolRegistry.getTool('pdf_info');
    expect(tool?.readOnly).toBe(true);
    const result = await tool!.execute({ path: 'a.pdf' });
    expect(captured).toBe('document_pdf_info');
    expect((result as any).info).toEqual({ pages: 3, has_text: true });
  });

  it('pdf_create tool delegates to pdfCreate', async () => {
    const { toolRegistry } = await import('../services/tools');
    let capturedCmd = '';
    let capturedArgs: Record<string, unknown> = {};
    pdfClient._mocks.invoke = async (cmd: string, args: Record<string, unknown>) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return undefined;
    };
    registerDocumentTools();
    const tool = toolRegistry.getTool('pdf_create');
    const result = await tool!.execute({ path: 'out.pdf', text: 'hi' });
    expect(capturedCmd).toBe('document_pdf_create');
    expect(capturedArgs).toMatchObject({ path: 'out.pdf', text: 'hi' });
    expect(result).toEqual({ created: true, path: 'out.pdf' });
  });

  it('registers the three Office/ODF edit tools (#222)', async () => {
    const { toolRegistry } = await import('../services/tools');
    registerDocumentTools();
    for (const name of ['document_edit', 'document_template_fill', 'document_odf_edit']) {
      expect(toolRegistry.getTool(name)).toBeDefined();
    }
  });

  it('document_edit tool delegates with a surgical {find,replace} op (#222)', async () => {
    const { toolRegistry } = await import('../services/tools');
    let capturedCmd = '';
    let capturedArgs: Record<string, unknown> = {};
    docsClient._mocks.invoke = async (cmd: string, args: Record<string, unknown>) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return { preview_text: 'Hello World', changed: true };
    };
    registerDocumentTools();
    const tool = toolRegistry.getTool('document_edit');
    const result = await tool!.execute({ path: 'a.docx', find: 'Hello', replace: 'World' });
    expect(capturedCmd).toBe('document_edit');
    expect(capturedArgs).toMatchObject({ path: 'a.docx', op: { find: 'Hello', replace: 'World' } });
    expect(result).toEqual({ preview_text: 'Hello World', changed: true });
  });

  it('document_template_fill tool delegates with a template op (#222)', async () => {
    const { toolRegistry } = await import('../services/tools');
    let capturedArgs: Record<string, unknown> = {};
    docsClient._mocks.invoke = async (_cmd: string, args: Record<string, unknown>) => {
      capturedArgs = args;
      return { preview_text: '', changed: true };
    };
    registerDocumentTools();
    const tool = toolRegistry.getTool('document_template_fill');
    await tool!.execute({ path: 'tmpl.docx', data: { name: 'Ada' } });
    expect(capturedArgs).toMatchObject({ path: 'tmpl.docx', op: { template: true, data: { name: 'Ada' } } });
  });

  it('document_odf_edit tool delegates to document_odf_edit (#222)', async () => {
    const { toolRegistry } = await import('../services/tools');
    let capturedCmd = '';
    let capturedArgs: Record<string, unknown> = {};
    docsClient._mocks.invoke = async (cmd: string, args: Record<string, unknown>) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return { preview_text: 'World', changed: true };
    };
    registerDocumentTools();
    const tool = toolRegistry.getTool('document_odf_edit');
    const result = await tool!.execute({ path: 'a.odt', find: 'Hello', replace: 'World' });
    expect(capturedCmd).toBe('document_odf_edit');
    expect(capturedArgs).toMatchObject({ path: 'a.odt', find: 'Hello', replace: 'World' });
    expect(result).toEqual({ preview_text: 'World', changed: true });
  });
});

// ── Error propagation (#233) ──────────────────────────────────────────────────

describe('documentTools wrappers propagate backend errors (#233)', () => {
  const ERR = new Error('unsupported format');

  beforeEach(() => {
    _mocks.invoke = async () => { throw ERR; };
  });

  it('readDocument rejects when the backend rejects', async () => {
    await expect(readDocument('bad.docx')).rejects.toBe(ERR);
  });

  it('convertDocument rejects when the backend rejects', async () => {
    await expect(convertDocument('a.docx', 'b.pdf')).rejects.toBe(ERR);
  });

  it('createDocument rejects when the backend rejects', async () => {
    await expect(createDocument('out.docx', 'docx', 'hello')).rejects.toBe(ERR);
  });

  it('documentFormats rejects when the backend rejects', async () => {
    await expect(documentFormats()).rejects.toBe(ERR);
  });
});

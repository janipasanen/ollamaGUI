import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  pdfInfo,
  pdfMerge,
  pdfSplit,
  pdfExtract,
  pdfCreate,
  readPdfText,
  type PdfInfo,
  _mocks,
} from '../services/documentsPdf';

beforeEach(() => {
  _mocks.invoke = null;
});

afterEach(() => {
  _mocks.invoke = null;
});

// ── pdfInfo ─────────────────────────────────────────────────────────────────

describe('pdfExtract / pdfCreate (#143)', () => {
  it('pdfExtract calls document_pdf_extract and returns text', async () => {
    let cmd = '';
    _mocks.invoke = async (c, _a) => { cmd = c; return 'extracted text'; };
    const text = await pdfExtract('doc.pdf');
    expect(cmd).toBe('document_pdf_extract');
    expect(text).toBe('extracted text');
  });
  it('pdfCreate calls document_pdf_create with path + text', async () => {
    let args: Record<string, unknown> = {};
    _mocks.invoke = async (_c, a) => { args = a; return undefined; };
    await pdfCreate('out.pdf', '# Title\nbody');
    expect(args.path).toBe('out.pdf');
    expect(args.text).toBe('# Title\nbody');
  });
});

describe('pdfInfo (#143)', () => {
  it('calls document_pdf_info with path', async () => {
    let capturedCmd = '';
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (cmd, args) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return { pages: 12, has_text: true };
    };
    await pdfInfo('report.pdf');
    expect(capturedCmd).toBe('document_pdf_info');
    expect(capturedArgs.path).toBe('report.pdf');
  });

  it('returns page count and has_text', async () => {
    _mocks.invoke = async () => ({ pages: 3, has_text: true } satisfies PdfInfo);
    const info = await pdfInfo('manual.pdf');
    expect(info.pages).toBe(3);
    expect(info.has_text).toBe(true);
  });

  it('reports a scanned PDF as having no text', async () => {
    _mocks.invoke = async () => ({ pages: 5, has_text: false } satisfies PdfInfo);
    const info = await pdfInfo('scan.pdf');
    expect(info.has_text).toBe(false);
    expect(info.pages).toBe(5);
  });

  it('degrades to zero pages when no PDF tool is installed', async () => {
    _mocks.invoke = async () => ({ pages: 0, has_text: false } satisfies PdfInfo);
    const info = await pdfInfo('mystery.pdf');
    expect(info.pages).toBe(0);
    expect(info.has_text).toBe(false);
  });
});

// ── pdfMerge ────────────────────────────────────────────────────────────────

describe('pdfMerge (#143, deferred)', () => {
  it('calls document_pdf_merge with paths and out', async () => {
    let capturedCmd = '';
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (cmd, args) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return undefined;
    };
    await pdfMerge(['a.pdf', 'b.pdf'], 'merged.pdf');
    expect(capturedCmd).toBe('document_pdf_merge');
    expect(capturedArgs.paths).toEqual(['a.pdf', 'b.pdf']);
    expect(capturedArgs.out).toBe('merged.pdf');
  });

  it('propagates the deferred error from the command', async () => {
    _mocks.invoke = async () => {
      throw new Error('PDF merge/split needs the lopdf crate (deferred)');
    };
    await expect(pdfMerge(['a.pdf'], 'out.pdf')).rejects.toThrow(/lopdf crate \(deferred\)/);
  });
});

// ── pdfSplit ────────────────────────────────────────────────────────────────

describe('pdfSplit (#143, deferred)', () => {
  it('calls document_pdf_split with path, ranges, outDir', async () => {
    let capturedCmd = '';
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (cmd, args) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return [];
    };
    await pdfSplit('big.pdf', '1-3,5', 'out/');
    expect(capturedCmd).toBe('document_pdf_split');
    expect(capturedArgs.path).toBe('big.pdf');
    expect(capturedArgs.ranges).toBe('1-3,5');
    expect(capturedArgs.outDir).toBe('out/');
  });

  it('returns the list of written file paths', async () => {
    _mocks.invoke = async () => ['out/part-1.pdf', 'out/part-2.pdf'];
    const files = await pdfSplit('big.pdf', '1-3,5', 'out/');
    expect(files).toEqual(['out/part-1.pdf', 'out/part-2.pdf']);
  });
});

// ── readPdfText ─────────────────────────────────────────────────────────────

describe('readPdfText (#143)', () => {
  it('reuses the document_read command with path', async () => {
    let capturedCmd = '';
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (cmd, args) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return { text: 'extracted body', format: 'pdf', title: null, word_count: 2 };
    };
    await readPdfText('paper.pdf');
    expect(capturedCmd).toBe('document_read');
    expect(capturedArgs.path).toBe('paper.pdf');
  });

  it('returns extracted text and metadata', async () => {
    _mocks.invoke = async () => ({
      text: 'Hello from PDF.',
      format: 'pdf',
      title: null,
      word_count: 3,
    });
    const doc = await readPdfText('hello.pdf');
    expect(doc.text).toBe('Hello from PDF.');
    expect(doc.format).toBe('pdf');
    expect(doc.word_count).toBe(3);
  });
});

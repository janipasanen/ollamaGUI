import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  convertDocument,
  cancelConversion,
  checkLibreOffice,
  _mocks,
  type ConvertProgress,
  type Unsubscribe,
} from '../services/documents';

beforeEach(() => {
  _mocks.invoke = null;
  _mocks.listen = null;
});

afterEach(() => {
  _mocks.invoke = null;
  _mocks.listen = null;
});

// ── convertDocument: command + arg mapping ─────────────────────────────────────

describe('convertDocument (#140)', () => {
  it('calls convert_document_tiered', async () => {
    let capturedCmd = '';
    _mocks.invoke = async (cmd) => {
      capturedCmd = cmd;
      return { engine: 'pandoc', ok: true };
    };
    await convertDocument('a.md', 'b.docx');
    expect(capturedCmd).toBe('convert_document_tiered');
  });

  it('maps fromPath / toPath / targetFormat into the invoke args', async () => {
    let captured: Record<string, unknown> = {};
    _mocks.invoke = async (_cmd, args) => {
      captured = args;
      return { engine: 'libreoffice', ok: true };
    };
    await convertDocument('/ws/in.docx', '/ws/out.pdf', 'pdf');
    expect(captured.fromPath).toBe('/ws/in.docx');
    expect(captured.toPath).toBe('/ws/out.pdf');
    expect(captured.targetFormat).toBe('pdf');
    expect(typeof captured.jobId).toBe('string');
    expect((captured.jobId as string).length).toBeGreaterThan(0);
  });

  it('infers targetFormat from the destination extension when omitted', async () => {
    let captured: Record<string, unknown> = {};
    _mocks.invoke = async (_cmd, args) => {
      captured = args;
      return { engine: 'pandoc', ok: true };
    };
    await convertDocument('notes.md', 'notes.DOCX');
    expect(captured.targetFormat).toBe('docx'); // lower-cased, dot stripped
  });

  it('returns the engine + ok result from the backend', async () => {
    _mocks.invoke = async () => ({ engine: 'libreoffice', ok: true });
    const result = await convertDocument('deck.pptx', 'deck.pdf');
    expect(result.engine).toBe('libreoffice');
    expect(result.ok).toBe(true);
  });

  it('propagates a missing-engine rejection from the backend', async () => {
    _mocks.invoke = async () => {
      throw 'PPTX/PDF export needs LibreOffice; install it or enable the optional engine';
    };
    await expect(convertDocument('deck.pptx', 'deck.pdf', 'pdf')).rejects.toMatch(
      /LibreOffice/,
    );
  });
});

// ── convertDocument: progress wiring ───────────────────────────────────────────

describe('convertDocument progress (#140)', () => {
  it('subscribes to convert://progress and forwards ratios to onProgress', async () => {
    let subscribedEvent = '';
    let emit: ((p: ConvertProgress) => void) | null = null;
    let unlistened = false;

    _mocks.listen = async (event, handler): Promise<Unsubscribe> => {
      subscribedEvent = event;
      emit = handler;
      return () => {
        unlistened = true;
      };
    };

    const ratios: number[] = [];
    _mocks.invoke = async () => {
      // Simulate the backend emitting progress during the conversion.
      emit?.({ job_id: '', ratio: 0.5 });
      emit?.({ job_id: '', ratio: 1.0 });
      return { engine: 'pandoc', ok: true };
    };

    await convertDocument('a.md', 'b.docx', undefined, {
      onProgress: (r) => ratios.push(r),
    });

    expect(subscribedEvent).toBe('convert://progress');
    expect(ratios).toEqual([0.5, 1.0]);
    // The subscription is torn down once the conversion settles.
    expect(unlistened).toBe(true);
  });

  it('does not subscribe to events when no onProgress is given', async () => {
    let listened = false;
    _mocks.listen = async (_event, _handler): Promise<Unsubscribe> => {
      listened = true;
      return () => {};
    };
    _mocks.invoke = async () => ({ engine: 'pandoc', ok: true });

    await convertDocument('a.md', 'b.docx');
    expect(listened).toBe(false);
  });
});

// ── convertDocument: cancellation via AbortSignal ──────────────────────────────

describe('convertDocument cancellation (#140)', () => {
  it('invokes convert_cancel when the signal aborts mid-flight', async () => {
    const calls: { cmd: string; args: Record<string, unknown> }[] = [];
    const controller = new AbortController();

    _mocks.invoke = async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'convert_document_tiered') {
        // Abort while the conversion is "running".
        controller.abort();
        return { engine: 'libreoffice', ok: true };
      }
      return undefined;
    };

    await convertDocument('big.pptx', 'big.pdf', 'pdf', { signal: controller.signal });

    const cancelCall = calls.find((c) => c.cmd === 'convert_cancel');
    expect(cancelCall).toBeDefined();
    // The cancel targets the same job id used for the conversion.
    const convertCall = calls.find((c) => c.cmd === 'convert_document_tiered');
    expect(cancelCall!.args.jobId).toBe(convertCall!.args.jobId);
  });

  it('cancels immediately when the signal is already aborted', async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    controller.abort(); // pre-aborted

    _mocks.invoke = async (cmd) => {
      calls.push(cmd);
      return cmd === 'convert_document_tiered' ? { engine: 'pandoc', ok: true } : undefined;
    };

    await convertDocument('a.md', 'b.docx', undefined, { signal: controller.signal });
    expect(calls).toContain('convert_cancel');
  });
});

// ── cancelConversion ───────────────────────────────────────────────────────────

describe('cancelConversion (#140)', () => {
  it('invokes convert_cancel with the job id', async () => {
    let captured: Record<string, unknown> = {};
    let cmd = '';
    _mocks.invoke = async (c, args) => {
      cmd = c;
      captured = args;
      return undefined;
    };
    await cancelConversion('convert-42');
    expect(cmd).toBe('convert_cancel');
    expect(captured.jobId).toBe('convert-42');
  });
});

// ── checkLibreOffice ───────────────────────────────────────────────────────────

describe('checkLibreOffice (#140)', () => {
  it('calls check_libreoffice_available', async () => {
    let capturedCmd = '';
    _mocks.invoke = async (cmd) => {
      capturedCmd = cmd;
      return { available: false };
    };
    await checkLibreOffice();
    expect(capturedCmd).toBe('check_libreoffice_available');
  });

  it('returns availability, path and version', async () => {
    _mocks.invoke = async () => ({
      available: true,
      path: '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      version: 'LibreOffice 7.6.4.1',
    });
    const result = await checkLibreOffice();
    expect(result.available).toBe(true);
    expect(result.path).toContain('soffice');
    expect(result.version).toContain('LibreOffice');
  });

  it('reports unavailable when LibreOffice is not installed', async () => {
    _mocks.invoke = async () => ({ available: false });
    const result = await checkLibreOffice();
    expect(result.available).toBe(false);
    expect(result.path).toBeUndefined();
  });
});

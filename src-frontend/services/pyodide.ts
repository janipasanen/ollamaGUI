/**
 * In-app Python execution via Pyodide (#128).
 *
 * Loads Pyodide lazily on first use (WebAssembly in-browser Python).
 * Captures stdout/stderr and returns a structured result.
 * The run_python tool is registered in toolRegistry for agent use.
 */

export interface PyRunResult {
  stdout: string;
  stderr: string;
  /** Repr of the last expression, or null if the code returned None / had no expr. */
  result: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------

export const _mocks = {
  /**
   * When set, completely replaces Pyodide loading and execution.
   * Receives the Python code string, returns PyRunResult.
   */
  runPython: null as ((code: string) => Promise<PyRunResult>) | null,
};

// ---------------------------------------------------------------------------
// Pyodide loader (singleton)
// ---------------------------------------------------------------------------

type PyodideInterface = {
  runPythonAsync(code: string): Promise<unknown>;
  globals: { get(key: string): unknown };
};

let _pyodide: PyodideInterface | null = null;
let _loading: Promise<PyodideInterface> | null = null;

async function loadPyodide(): Promise<PyodideInterface> {
  if (_pyodide) return _pyodide;
  if (_loading) return _loading;

  _loading = (async () => {
    // Pyodide exposes itself via a global after the CDN script loads.
    const globalAny = globalThis as Record<string, unknown>;
    if (!globalAny.loadPyodide) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Pyodide script'));
        document.head.appendChild(script);
      });
    }
    const loader = globalAny.loadPyodide as (opts: { indexURL: string }) => Promise<PyodideInterface>;
    const pyodide = await loader({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/',
    });
    _pyodide = pyodide;
    return pyodide;
  })();

  return _loading;
}

/** Reset the Pyodide singleton (used in tests to avoid state leakage). */
export function resetPyodideInstance(): void {
  _pyodide = null;
  _loading = null;
}

// ---------------------------------------------------------------------------
// Python execution
// ---------------------------------------------------------------------------

const CAPTURE_SETUP = `
import sys
import io as _io
_stdout_buf = _io.StringIO()
_stderr_buf = _io.StringIO()
sys.stdout = _stdout_buf
sys.stderr = _stderr_buf
`;

const CAPTURE_TEARDOWN = `
sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__
(__stdout_val, __stderr_val) = (_stdout_buf.getvalue(), _stderr_buf.getvalue())
`;

/**
 * Execute a Python code snippet and return captured output.
 *
 * Wraps execution in stdout/stderr capture using StringIO.
 * The return value is the repr() of the last expression (if any).
 */
export async function runPython(code: string): Promise<PyRunResult> {
  if (_mocks.runPython) return _mocks.runPython(code);

  const pyodide = await loadPyodide();

  try {
    await pyodide.runPythonAsync(CAPTURE_SETUP);

    let rawResult: unknown = null;
    let execError: string | null = null;

    try {
      rawResult = await pyodide.runPythonAsync(code);
    } catch (err: unknown) {
      execError = err instanceof Error ? err.message : String(err);
    }

    await pyodide.runPythonAsync(CAPTURE_TEARDOWN);

    const stdout = String(pyodide.globals.get('__stdout_val') ?? '');
    const stderr = String(pyodide.globals.get('__stderr_val') ?? '');

    let result: string | null = null;
    if (execError === null && rawResult !== null && rawResult !== undefined) {
      result = String(rawResult);
    }

    return { stdout, stderr, result, error: execError };
  } catch (outerErr: unknown) {
    return {
      stdout: '',
      stderr: '',
      result: null,
      error: outerErr instanceof Error ? outerErr.message : String(outerErr),
    };
  }
}

// ---------------------------------------------------------------------------
// Agent tool registration
// ---------------------------------------------------------------------------

import { toolRegistry } from './tools';

export function registerPythonTool(): void {
  toolRegistry.registerTool({
    name: 'run_python',
    description:
      'Execute a Python code snippet in-browser via Pyodide. Returns captured stdout, stderr, and the value of the last expression.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Python code to execute' },
      },
      required: ['code'],
    },
    execute: async (params) => runPython(params.code as string),
  });
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerBrowserTools,
  unregisterBrowserTools,
  BROWSER_TOOL_NAMES,
  _mocks,
} from '../services/browser-tools';
import { toolRegistry } from '../services/tools';
import { browserSession, browserBus } from '../services/browser';

// A permissive approval callback that records calls and resolves a fixed verdict.
function makeApproval(verdict: boolean) {
  const calls: Array<{ action: string; detail: string }> = [];
  const cb = async (action: string, detail: string) => {
    calls.push({ action, detail });
    return verdict;
  };
  return { cb, calls };
}

// Reset all shared singletons between tests so each case is isolated. The
// toolRegistry / browserSession are module-level singletons shared across the
// whole suite, so we must undo any mutation we make.
beforeEach(() => {
  _mocks.invoke = null;
  browserSession.engineConnected = false;
  browserSession.currentUrl = '';
  browserSession.lastSnapshotRefs = {};
});

afterEach(() => {
  // Clean up registered tools to avoid leaking into other test files that
  // inspect the shared registry.
  unregisterBrowserTools();
  _mocks.invoke = null;
  browserSession.engineConnected = false;
  browserSession.currentUrl = '';
  browserSession.lastSnapshotRefs = {};
});

// ── Registration ────────────────────────────────────────────────────────────

describe('registerBrowserTools — registration (#74)', () => {
  it('registers all nine browser tools', () => {
    const { cb } = makeApproval(true);
    registerBrowserTools(cb);
    expect(BROWSER_TOOL_NAMES).toHaveLength(9);
    for (const name of BROWSER_TOOL_NAMES) {
      expect(toolRegistry.getTool(name)).toBeDefined();
    }
  });

  it('marks read-only tools as readOnly and acting tools as not', () => {
    const { cb } = makeApproval(true);
    registerBrowserTools(cb);
    // Read-only set.
    for (const name of [
      'browser_snapshot',
      'browser_screenshot',
      'browser_read_console',
      'browser_wait_for',
      'browser_assert',
    ]) {
      expect(toolRegistry.getTool(name)?.readOnly).toBe(true);
    }
    // Acting set (mutating) — readOnly is falsy.
    for (const name of ['browser_navigate', 'browser_click', 'browser_type', 'browser_eval']) {
      expect(toolRegistry.getTool(name)?.readOnly).toBeFalsy();
    }
  });

  it('unregisterBrowserTools removes every tool from the registry', () => {
    const { cb } = makeApproval(true);
    registerBrowserTools(cb);
    unregisterBrowserTools();
    for (const name of BROWSER_TOOL_NAMES) {
      expect(toolRegistry.getTool(name)).toBeUndefined();
    }
  });
});

// ── browser_click ─────────────────────────────────────────────────────────────

describe('browser_click (#74)', () => {
  it('calls browser_cdp_click with { refId }', async () => {
    const { cb } = makeApproval(true);
    let capturedCmd = '';
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (cmd, args) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return { ok: true };
    };
    registerBrowserTools(cb);

    // Pre-connect the engine so we observe the click command, not the start.
    browserSession.engineConnected = true;
    await toolRegistry.getTool('browser_click')!.execute({ ref: 'e7' });

    expect(capturedCmd).toBe('browser_cdp_click');
    expect(capturedArgs.refId).toBe('e7');
  });
});

// ── Sensitive: eval + off-allowlist navigate ──────────────────────────────────

describe('sensitive tools require approval and deny on false (#74)', () => {
  it('browser_eval calls onApprovalRequired and returns {error:denied} when denied', async () => {
    const { cb, calls } = makeApproval(false);
    let invoked = false;
    _mocks.invoke = async () => {
      invoked = true;
      return {};
    };
    registerBrowserTools(cb);

    const result = await toolRegistry.getTool('browser_eval')!.execute({
      expression: 'document.title',
    });

    expect(calls).toEqual([{ action: 'eval', detail: 'document.title' }]);
    expect(result).toEqual({ error: 'denied' });
    // Denied eval must never reach the engine.
    expect(invoked).toBe(false);
  });

  it('off-allowlist browser_navigate calls onApprovalRequired and denies on false', async () => {
    const { cb, calls } = makeApproval(false);
    let invoked = false;
    _mocks.invoke = async () => {
      invoked = true;
      return {};
    };
    registerBrowserTools(cb);

    const result = await toolRegistry.getTool('browser_navigate')!.execute({
      url: 'https://example.com',
    });

    expect(calls).toEqual([{ action: 'navigate', detail: 'https://example.com' }]);
    expect(result).toEqual({ error: 'denied' });
    expect(invoked).toBe(false);
  });

  it('localhost browser_navigate does NOT require approval', async () => {
    const { cb, calls } = makeApproval(false);
    let capturedCmd = '';
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (cmd, args) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return { ok: true };
    };
    registerBrowserTools(cb);
    browserSession.engineConnected = true; // isolate the navigate command

    await toolRegistry.getTool('browser_navigate')!.execute({
      url: 'http://localhost:5173/app',
    });

    // No approval call for the local dev surface; it navigates directly.
    expect(calls).toHaveLength(0);
    expect(capturedCmd).toBe('browser_cdp_navigate');
    expect(capturedArgs.url).toBe('http://localhost:5173/app');
  });
});

// ── Read-only tools never prompt ──────────────────────────────────────────────

describe('read-only tools never call onApprovalRequired (#74)', () => {
  it('snapshot / screenshot / read_console / assert / wait_for skip approval', async () => {
    const { cb, calls } = makeApproval(false);
    _mocks.invoke = async (cmd) => {
      // Provide a shape the wait_for / assert pollers can consume.
      if (cmd === 'browser_cdp_get_ax_tree') {
        return { refs: { e1: { role: 'button', name: 'Submit' } }, text: 'Submit' };
      }
      return { ok: true };
    };
    registerBrowserTools(cb);

    await toolRegistry.getTool('browser_snapshot')!.execute({});
    await toolRegistry.getTool('browser_screenshot')!.execute({ fullPage: true });
    await toolRegistry.getTool('browser_read_console')!.execute({ clear: true });
    await toolRegistry.getTool('browser_assert')!.execute({
      type: 'text_present',
      expected: 'Submit',
    });
    await toolRegistry.getTool('browser_wait_for')!.execute({ text: 'Submit' });

    // None of the read-only tools may prompt for approval.
    expect(calls).toHaveLength(0);
  });

  it('read-only tools do not auto-start the engine', async () => {
    const { cb } = makeApproval(true);
    const startedCmds: string[] = [];
    _mocks.invoke = async (cmd) => {
      startedCmds.push(cmd);
      if (cmd === 'browser_cdp_get_ax_tree') return { refs: {}, text: '' };
      return { ok: true };
    };
    registerBrowserTools(cb);

    await toolRegistry.getTool('browser_snapshot')!.execute({});
    expect(browserSession.engineConnected).toBe(false);
    expect(startedCmds).not.toContain('browser_engine_start');
  });
});

// ── Schema / enum survives into Ollama definitions ────────────────────────────

describe('browser_assert schema (#74)', () => {
  it('exposes the type enum and survives getOllamaToolDefinitions()', () => {
    const { cb } = makeApproval(true);
    registerBrowserTools(cb);

    const tool = toolRegistry.getTool('browser_assert')!;
    expect(tool.parameters.properties.type.enum).toEqual([
      'url_contains',
      'text_present',
      'element_exists',
    ]);

    const defs = toolRegistry.getOllamaToolDefinitions();
    const assertDef = defs.find((d) => d.function.name === 'browser_assert');
    expect(assertDef).toBeDefined();
    expect(assertDef.function.parameters.properties.type.enum).toEqual([
      'url_contains',
      'text_present',
      'element_exists',
    ]);
  });
});

// ── Engine auto-start on first acting tool ────────────────────────────────────

describe('engine auto-start (#74)', () => {
  it('first acting tool invokes browser_engine_start and emits engine-status', async () => {
    const { cb } = makeApproval(true);
    const cmds: string[] = [];
    let startArgs: Record<string, unknown> = {};
    _mocks.invoke = async (cmd, args) => {
      cmds.push(cmd);
      if (cmd === 'browser_engine_start') startArgs = args;
      return { ok: true };
    };

    let statusPayload: any = null;
    const onStatus = (payload: any) => {
      statusPayload = payload;
    };
    browserBus.on('engine-status', onStatus);

    try {
      registerBrowserTools(cb);
      expect(browserSession.engineConnected).toBe(false);

      // A localhost navigate is an acting tool but skips approval, so it cleanly
      // exercises the auto-start path.
      await toolRegistry.getTool('browser_navigate')!.execute({
        url: 'http://localhost:3000',
      });

      // Engine started first, then the navigate command ran.
      expect(cmds[0]).toBe('browser_engine_start');
      expect(startArgs.headless).toBe(false);
      expect(cmds).toContain('browser_cdp_navigate');
      expect(browserSession.engineConnected).toBe(true);
      expect(statusPayload).toEqual({ connected: true });
    } finally {
      browserBus.off('engine-status', onStatus);
    }
  });

  it('does not restart the engine when already connected', async () => {
    const { cb } = makeApproval(true);
    const cmds: string[] = [];
    _mocks.invoke = async (cmd) => {
      cmds.push(cmd);
      return { ok: true };
    };
    registerBrowserTools(cb);
    browserSession.engineConnected = true;

    await toolRegistry.getTool('browser_click')!.execute({ ref: 'e3' });

    expect(cmds).not.toContain('browser_engine_start');
    expect(cmds).toContain('browser_cdp_click');
  });
});

// ── Secret-field credential path for browser_type ─────────────────────────────

describe('browser_type secret routing (#74)', () => {
  it('routes secret fields through type-secret approval and never forwards text', async () => {
    const { cb, calls } = makeApproval(true);
    const cmds: string[] = [];
    let typedArgs: Record<string, unknown> | null = null;
    _mocks.invoke = async (cmd, args) => {
      cmds.push(cmd);
      if (cmd === 'browser_cdp_type') typedArgs = args;
      return { ok: true };
    };
    registerBrowserTools(cb);
    browserSession.engineConnected = true;
    browserSession.lastSnapshotRefs = {
      e9: { role: 'textbox', name: 'Password', isSecret: true },
    };

    const result = await toolRegistry.getTool('browser_type')!.execute({
      ref: 'e9',
      text: 'hunter2',
      submit: true,
    });

    // Approval requested for the secret, and the value never reached the engine
    // type command (no browser_cdp_type with the plaintext).
    expect(calls).toEqual([{ action: 'type-secret', detail: 'e9' }]);
    expect(cmds).not.toContain('browser_cdp_type');
    expect(typedArgs).toBeNull();
    expect(result).toMatchObject({ secret: true, redacted: true });
    // Defensive: the plaintext must not appear in the serialized result.
    expect(JSON.stringify(result)).not.toContain('hunter2');
  });

  it('non-secret fields type directly via browser_cdp_type with submit flag', async () => {
    const { cb, calls } = makeApproval(true);
    let capturedArgs: Record<string, unknown> = {};
    _mocks.invoke = async (cmd, args) => {
      if (cmd === 'browser_cdp_type') capturedArgs = args;
      return { ok: true };
    };
    registerBrowserTools(cb);
    browserSession.engineConnected = true;
    browserSession.lastSnapshotRefs = {
      e2: { role: 'textbox', name: 'Search' },
    };

    await toolRegistry.getTool('browser_type')!.execute({
      ref: 'e2',
      text: 'ollama',
      submit: true,
    });

    expect(calls).toHaveLength(0);
    expect(capturedArgs).toEqual({ refId: 'e2', text: 'ollama', submit: true });
  });
});

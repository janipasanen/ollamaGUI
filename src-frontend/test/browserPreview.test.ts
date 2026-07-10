import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  openPreview,
  navigatePreview,
  setBoundsPreview,
  reloadPreview,
  closePreview,
  isPreviewOpen,
  _resetPreviewState,
  _mocks,
  type PreviewRect,
} from '../services/browserPreview';

const RECT: PreviewRect = { x: 1, y: 2, width: 3, height: 4 };

beforeEach(() => {
  _mocks.invoke = null;
  _resetPreviewState();
});

afterEach(() => {
  _mocks.invoke = null;
  _resetPreviewState();
});

describe('browserPreview (#172)', () => {
  it('openPreview invokes preview_webview_open with allow=[] and marks open', async () => {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    _mocks.invoke = async (cmd, args) => { calls.push({ cmd, args }); };
    await openPreview('https://example.com', RECT);
    expect(calls).toContainEqual({ cmd: 'preview_webview_open', args: { url: 'https://example.com', rect: RECT, allow: [] } });
    expect(isPreviewOpen()).toBe(true);
  });

  it('openPreview forwards a custom allow-list', async () => {
    let captured: Record<string, unknown> = {};
    _mocks.invoke = async (_cmd, args) => { captured = args; };
    await openPreview('https://example.com', RECT, ['https://example.com']);
    expect(captured.allow).toEqual(['https://example.com']);
  });

  it('openPreview sets _open optimistically (before the IPC resolves)', () => {
    _mocks.invoke = () => new Promise(() => {}); // never resolves
    void openPreview('https://example.com', RECT);
    expect(isPreviewOpen()).toBe(true);
  });

  it('setBoundsPreview no-ops when the preview is closed', async () => {
    let called = false;
    _mocks.invoke = async () => { called = true; };
    await setBoundsPreview(RECT);
    expect(called).toBe(false);
  });

  it('setBoundsPreview invokes preview_webview_set_bounds when open', async () => {
    const cmds: string[] = [];
    _mocks.invoke = async (cmd) => { cmds.push(cmd); };
    await openPreview('https://example.com', RECT);
    await setBoundsPreview(RECT);
    expect(cmds).toContain('preview_webview_set_bounds');
  });

  it('reloadPreview no-ops when closed and invokes when open', async () => {
    const cmds: string[] = [];
    _mocks.invoke = async (cmd) => { cmds.push(cmd); };
    await reloadPreview();
    expect(cmds).not.toContain('preview_webview_reload');
    await openPreview('https://example.com', RECT);
    await reloadPreview();
    expect(cmds).toContain('preview_webview_reload');
  });

  it('navigatePreview no-ops when closed and invokes when open', async () => {
    const cmds: string[] = [];
    _mocks.invoke = async (cmd) => { cmds.push(cmd); };
    await navigatePreview('https://example.com/x');
    expect(cmds).not.toContain('preview_webview_navigate');
    await openPreview('https://example.com', RECT);
    await navigatePreview('https://example.com/x');
    expect(cmds).toContain('preview_webview_navigate');
  });

  it('closePreview invokes preview_webview_close and clears open', async () => {
    const cmds: string[] = [];
    _mocks.invoke = async (cmd) => { cmds.push(cmd); };
    await openPreview('https://example.com', RECT);
    await closePreview();
    expect(cmds).toContain('preview_webview_close');
    expect(isPreviewOpen()).toBe(false);
  });

  it('closePreview no-ops when already closed', async () => {
    let called = false;
    _mocks.invoke = async () => { called = true; };
    await closePreview();
    expect(called).toBe(false);
  });

  it('closePreview clears open even if the close IPC rejects', async () => {
    _mocks.invoke = async () => {};
    await openPreview('https://example.com', RECT);
    _mocks.invoke = async () => { throw new Error('no runtime'); };
    await closePreview();
    expect(isPreviewOpen()).toBe(false);
  });

  it('_resetPreviewState clears the open flag', async () => {
    _mocks.invoke = async () => {};
    await openPreview('https://example.com', RECT);
    expect(isPreviewOpen()).toBe(true);
    _resetPreviewState();
    expect(isPreviewOpen()).toBe(false);
  });

  // ── #437: openPreview must reset _open on rejection ───────────────────────

  it('openPreview resets _open=false when the IPC rejects (#437)', async () => {
    _mocks.invoke = async () => { throw new Error('webview unavailable'); };
    await expect(openPreview('https://example.com', RECT)).rejects.toThrow('webview unavailable');
    expect(isPreviewOpen()).toBe(false);
  });

  it('after a rejected openPreview, navigatePreview no-ops (#437)', async () => {
    const cmds: string[] = [];
    _mocks.invoke = async (cmd) => {
      if (cmd === 'preview_webview_open') throw new Error('no runtime');
      cmds.push(cmd);
    };
    await expect(openPreview('https://example.com', RECT)).rejects.toThrow();
    await navigatePreview('https://example.com/x');
    expect(cmds).not.toContain('preview_webview_navigate');
  });

  it('after a rejected openPreview, setBoundsPreview no-ops (#437)', async () => {
    let called = false;
    _mocks.invoke = async (cmd) => {
      if (cmd === 'preview_webview_open') throw new Error('no runtime');
      called = true;
    };
    await expect(openPreview('https://example.com', RECT)).rejects.toThrow();
    await setBoundsPreview(RECT);
    expect(called).toBe(false);
  });

  // ── #450: follow-up calls must wait for openPreview to complete ───────────

  it('navigatePreview waits for openPreview IPC to resolve before sending (#450)', async () => {
    const order: string[] = [];
    let resolveOpen: () => void;
    const openPromise = new Promise<void>(r => { resolveOpen = r; });
    _mocks.invoke = async (cmd) => {
      if (cmd === 'preview_webview_open') {
        order.push('open_start');
        await openPromise;
        order.push('open_done');
        return;
      }
      order.push(cmd);
    };
    // Fire openPreview (doesn't resolve yet) and navigatePreview concurrently
    const openP = openPreview('https://example.com', RECT);
    const navP = navigatePreview('https://example.com/x');
    // Give the event loop a tick to let navigatePreview reach the await
    await new Promise(r => setTimeout(r, 10));
    // navigate should NOT have fired yet — open is still pending
    expect(order).not.toContain('preview_webview_navigate');
    // Now resolve the open
    resolveOpen!();
    await openP;
    await navP;
    // navigate should fire AFTER open completes
    const navIdx = order.indexOf('preview_webview_navigate');
    const openDoneIdx = order.indexOf('open_done');
    expect(navIdx).toBeGreaterThan(openDoneIdx);
  });

  it('setBoundsPreview waits for openPreview IPC to resolve before sending (#450)', async () => {
    const order: string[] = [];
    let resolveOpen: () => void;
    const openPromise = new Promise<void>(r => { resolveOpen = r; });
    _mocks.invoke = async (cmd) => {
      if (cmd === 'preview_webview_open') {
        await openPromise;
        return;
      }
      order.push(cmd);
    };
    const openP = openPreview('https://example.com', RECT);
    const boundsP = setBoundsPreview(RECT);
    await new Promise(r => setTimeout(r, 10));
    expect(order).not.toContain('preview_webview_set_bounds');
    resolveOpen!();
    await openP;
    await boundsP;
    expect(order).toContain('preview_webview_set_bounds');
  });

  it('reloadPreview waits for openPreview IPC to resolve before sending (#450)', async () => {
    const order: string[] = [];
    let resolveOpen: () => void;
    const openPromise = new Promise<void>(r => { resolveOpen = r; });
    _mocks.invoke = async (cmd) => {
      if (cmd === 'preview_webview_open') {
        await openPromise;
        return;
      }
      order.push(cmd);
    };
    const openP = openPreview('https://example.com', RECT);
    const reloadP = reloadPreview();
    await new Promise(r => setTimeout(r, 10));
    expect(order).not.toContain('preview_webview_reload');
    resolveOpen!();
    await openP;
    await reloadP;
    expect(order).toContain('preview_webview_reload');
  });

  it('follow-up calls no-op when openPreview rejects while waiting (#450)', async () => {
    let rejectOpen: (e: Error) => void;
    const openPromise = new Promise<void>((_, r) => { rejectOpen = r; });
    const cmds: string[] = [];
    _mocks.invoke = async (cmd) => {
      if (cmd === 'preview_webview_open') { await openPromise; return; }
      cmds.push(cmd);
    };
    const openP = openPreview('https://example.com', RECT);
    const navP = navigatePreview('https://example.com/x');
    await new Promise(r => setTimeout(r, 10));
    // Reject the open — navigate should no-op, not send
    rejectOpen!(new Error('failed'));
    await expect(openP).rejects.toThrow('failed');
    await navP;
    expect(cmds).not.toContain('preview_webview_navigate');
    expect(isPreviewOpen()).toBe(false);
  });
});

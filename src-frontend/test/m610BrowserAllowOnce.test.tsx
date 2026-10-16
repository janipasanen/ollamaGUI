import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';
import { toolRegistry } from '../services/tools';
import { _mocks, unregisterBrowserTools } from '../services/browser-tools';
import { clearBrowserAllowlist, isHostAllowed, clearBrowserApprovalCallback } from '../services/browserApproval';
import { browserSession } from '../services/browser';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  _mocks.invoke = null;
  clearBrowserAllowlist();
  clearBrowserApprovalCallback();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes('/api/chat')) {
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: vi.fn()
              .mockResolvedValueOnce({ done: false, value: Buffer.from('{"message":{"content":"ok"}}\n') })
              .mockResolvedValueOnce({ done: true, value: undefined }),
          }),
        },
      } as any;
    }
    return { ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any;
  });
});

afterEach(() => {
  global.fetch = origFetch;
  _mocks.invoke = null;
  clearBrowserAllowlist();
  clearBrowserApprovalCallback();
  browserSession.engineConnected = false;
  unregisterBrowserTools();
});

// "Allow Once" approves the navigation but must NOT keep the host allow-listed
// for the session (#610). "Always Allow" should.
describe('browser "Allow Once" does not host-allow-list (#610)', () => {
  it('approves the navigation but leaves the host NOT allow-listed', async () => {
    _mocks.invoke = async () => ({ ok: true });
    const host = 'https://once-allow.example.com';
    render(<App />);
    await waitFor(() => expect(toolRegistry.getTool('browser_navigate')).toBeDefined(), { timeout: 3000 });
    clearBrowserAllowlist();

    const promise = toolRegistry.getTool('browser_navigate')!.execute({ url: host });
    await waitFor(() => expect(screen.getByText('Command Approval Required')).toBeInTheDocument(), { timeout: 3000 });
    // "Allow Once" (not "Always Allow") — the host must NOT be keep-allow-listed.
    await waitFor(() => {
      fireEvent.click(screen.getByText('Allow Once'));
      expect(screen.queryByText('Command Approval Required')).not.toBeInTheDocument();
    }, { timeout: 3000 });

    await promise;
    expect(isHostAllowed(host)).toBe(false);
  });

  it('"Always Allow" approves AND keeps the host allow-listed', async () => {
    _mocks.invoke = async () => ({ ok: true });
    const host = 'https://always-allow.example.com';
    render(<App />);
    await waitFor(() => expect(toolRegistry.getTool('browser_navigate')).toBeDefined(), { timeout: 3000 });
    clearBrowserAllowlist();

    const promise = toolRegistry.getTool('browser_navigate')!.execute({ url: host });
    await waitFor(() => expect(screen.getByText('Command Approval Required')).toBeInTheDocument(), { timeout: 3000 });
    await waitFor(() => {
      fireEvent.click(screen.getByText('Always Allow'));
      expect(screen.queryByText('Command Approval Required')).not.toBeInTheDocument();
    }, { timeout: 3000 });

    await promise;
    expect(isHostAllowed(host)).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';
import { toolRegistry } from '../services/tools';
import { loadDisabledTools } from '../services/toolConfig';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
  toolRegistry.registerTool({ name: 'test_tool', description: 'A test tool', parameters: { type: 'object', properties: {} }, execute: async () => ({}) });
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
  toolRegistry.unregisterTool('test_tool');
});

describe('Per-tool enable/disable toggle in Settings (#399)', () => {
  it('toggling a tool off persists it as disabled and updates the switch', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /⚙️ Settings/i }));

    const sw = screen.getByRole('switch', { name: 'Toggle test_tool' });
    expect(sw).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(sw);
    await screen.findByRole('switch', { name: 'Toggle test_tool' });
    expect(screen.getByRole('switch', { name: 'Toggle test_tool' })).toHaveAttribute('aria-checked', 'false');
    expect(loadDisabledTools().has('test_tool')).toBe(true);
  });
});

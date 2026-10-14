/**
 * #521: the MCP OAuth badge must be derived from the token store, not from
 * transient React state — it used to reset on every server-list refresh.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const authMocks = vi.hoisted(() => ({
  load: vi.fn(async (_id: string) => ({ access_token: 'tok', expires_at: Date.now() + 3_600_000 })),
}));
vi.mock('../services/mcpAuth', async (orig) => {
  const actual = await (orig() as Promise<Record<string, any>>);
  return {
    ...actual,
    tokenStore: { ...actual.tokenStore, load: authMocks.load },
  };
});

import App from '../App';
import { mcpConfigStore } from '../services/mcpConfig';

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
  window.dispatchEvent(new Event('resize'));
});

describe('MCP OAuth badge persistence (#521)', () => {
  it('derives the authenticated badge from stored tokens on load', async () => {
    mcpConfigStore.save({
      id: 'srv_auth', name: 'AuthServer', type: 'http', url: 'https://mcp.example.com',
      enabled: true, toolsEnabled: true, authRequired: true,
    } as any);

    render(<App />);
    // Open settings to reach the MCP section.
    screen.getByText('⚙️ Settings').click();
    await waitFor(() => {
      expect(screen.getByText('🔑 auth')).toBeInTheDocument();
    }, { timeout: 5000 });
    expect(authMocks.load).toHaveBeenCalledWith('srv_auth');
  });
});

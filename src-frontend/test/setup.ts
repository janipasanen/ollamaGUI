// Test setup file
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// jsdom does not implement URL.createObjectURL / URL.revokeObjectURL
if (!URL.createObjectURL) {
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:mock"),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
}

// jsdom doesn't implement scrollIntoView
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}

// Mock fetch for all tests under jsdom — individual tests can override via
// vi.spyOn / mockResolvedValue. Skip entirely in the Node environment (used by
// the OPENAI_LIVE integration tests) so real streaming fetch is preserved.
if (typeof window !== 'undefined') {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ models: [] }),
    body: null,
    text: async () => '',
  });
}

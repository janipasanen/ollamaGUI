/**
 * MCP server preset catalog integrity (#173): the curated one-click-setup
 * catalog must have stable, unique keys and well-formed entries so the
 * "Add MCP server" form can pre-fill reliably.
 */
import { describe, it, expect } from 'vitest';
import { MCP_SERVER_PRESETS, getMcpPreset, type McpServerPreset } from '../services/mcpPresets';

describe('MCP server preset catalog (#173)', () => {
  it('is non-empty', () => {
    expect(MCP_SERVER_PRESETS.length).toBeGreaterThan(0);
  });

  it('has unique keys', () => {
    const keys = MCP_SERVER_PRESETS.map(p => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every preset has a name, description, icon, and docsUrl', () => {
    for (const p of MCP_SERVER_PRESETS) {
      expect(p.name.trim()).toBeTruthy();
      expect(p.description.trim()).toBeTruthy();
      expect(p.icon.trim()).toBeTruthy();
      expect(p.docsUrl).toMatch(/^https?:\/\//);
    }
  });

  it('every preset has a transport type and either a command (stdio) or url (http)', () => {
    for (const p of MCP_SERVER_PRESETS) {
      expect(['stdio', 'http']).toContain(p.type);
      if (p.type === 'stdio') expect(p.command?.trim()).toBeTruthy();
      if (p.type === 'http') expect(p.url?.trim()).toBeTruthy();
    }
  });

  it('deprecated presets/variants carry a security note', () => {
    const check = (label: string, preset: { deprecated?: boolean; securityNote?: string }) => {
      if (preset.deprecated) {
        expect(preset.securityNote, `${label} is deprecated but has no securityNote`).toBeTruthy();
      }
    };
    for (const p of MCP_SERVER_PRESETS) {
      check(p.key, p);
      (p.variants ?? []).forEach((v, i) => check(`${p.key} variant ${i}`, v));
    }
  });

  it('variant keys (labels) are unique within a preset', () => {
    for (const p of MCP_SERVER_PRESETS) {
      if (!p.variants || p.variants.length === 0) continue;
      const labels = p.variants.map(v => v.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('getMcpPreset finds a preset by key', () => {
    const first = MCP_SERVER_PRESETS[0];
    expect(getMcpPreset(first.key)).toBe(first);
  });

  it('getMcpPreset returns undefined for an unknown key', () => {
    expect(getMcpPreset('does-not-exist')).toBeUndefined();
  });

  it('secret env fields are flagged secret', () => {
    const secrets = new Set<string>();
    for (const p of MCP_SERVER_PRESETS) {
      for (const f of p.env ?? []) if (f.secret) secrets.add(f.key);
      for (const v of p.variants ?? []) for (const f of v.env ?? []) if (f.secret) secrets.add(f.key);
    }
    // Any field flagged secret must have a non-empty key (catalog sanity).
    for (const k of secrets) expect(k.trim()).toBeTruthy();
    expect(secrets.size).toBeGreaterThan(0); // e.g. GitHub PAT
  });
});

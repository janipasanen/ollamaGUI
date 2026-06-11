import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadThemeSettings, saveThemeSettings, resolveDark, applyTheme,
  DEFAULT_THEME, ACCENTS, ThemeSettings,
} from '../services/theme';

describe('theme settings (#136)', () => {
  beforeEach(() => localStorage.clear());

  it('returns defaults when nothing is stored', () => {
    expect(loadThemeSettings()).toEqual(DEFAULT_THEME);
  });

  it('round-trips settings', () => {
    const s: ThemeSettings = { mode: 'light', accent: ACCENTS.green, density: 'compact' };
    saveThemeSettings(s);
    expect(loadThemeSettings()).toEqual(s);
  });

  it('migrates the legacy ollama_gui_theme string', () => {
    localStorage.setItem('ollama_gui_theme', 'light');
    const loaded = loadThemeSettings();
    expect(loaded.mode).toBe('light');
    expect(loaded.accent).toBe(DEFAULT_THEME.accent);
  });

  it('resolveDark consults matchMedia for system mode', () => {
    const mql = { matches: true } as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql));
    expect(resolveDark('system')).toBe(true);
    (mql as any).matches = false;
    expect(resolveDark('system')).toBe(false);
    expect(resolveDark('dark')).toBe(true);
    expect(resolveDark('light')).toBe(false);
    vi.unstubAllGlobals();
  });

  it('applyTheme sets the --accent CSS variable and density attribute', () => {
    applyTheme({ mode: 'dark', accent: '#abcdef', density: 'compact' });
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#abcdef');
    expect(document.documentElement.getAttribute('data-density')).toBe('compact');
  });
});

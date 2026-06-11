// Appearance settings: light/dark/system mode, accent color, density.
// Replaces the legacy bare `ollama_gui_theme` ('light'|'dark') string, with migration.

export type ThemeMode = 'light' | 'dark' | 'system';
export type Density = 'cozy' | 'compact';

export interface ThemeSettings {
  mode: ThemeMode;
  accent: string; // hex color
  density: Density;
}

export const ACCENTS: Record<string, string> = {
  blue: '#2563eb',
  violet: '#7c3aed',
  green: '#16a34a',
  rose: '#e11d48',
  amber: '#d97706',
  cyan: '#0891b2',
};

export const DEFAULT_THEME: ThemeSettings = { mode: 'dark', accent: ACCENTS.blue, density: 'cozy' };

const KEY = 'ollama_gui_theme_v2';
const LEGACY_KEY = 'ollama_gui_theme';

export function loadThemeSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_THEME, ...JSON.parse(raw) };
    // Migrate the legacy 'light'|'dark' string.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === 'light' || legacy === 'dark') {
      return { ...DEFAULT_THEME, mode: legacy };
    }
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULT_THEME };
}

export function saveThemeSettings(settings: ThemeSettings): ThemeSettings {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
    // Keep the legacy key in sync so older code paths still read a sane value.
    localStorage.setItem(LEGACY_KEY, settings.mode === 'light' ? 'light' : 'dark');
  } catch {
    /* ignore quota / unavailable storage */
  }
  return settings;
}

/** Resolve whether dark styling applies, consulting the OS when mode is 'system'. */
export function resolveDark(mode: ThemeMode): boolean {
  if (mode === 'system') {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return true; // default dark when matchMedia is unavailable
    }
  }
  return mode === 'dark';
}

/** Apply accent color + density to the document root via CSS variables / data attributes. */
export function applyTheme(settings: ThemeSettings): void {
  try {
    const root = document.documentElement;
    root.style.setProperty('--accent', settings.accent);
    root.setAttribute('data-density', settings.density);
  } catch {
    /* no document (non-DOM env) */
  }
}

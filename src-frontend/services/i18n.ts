/**
 * Interface language (#564): English by default, Swedish selectable in
 * Settings.
 *
 * Deliberately dependency-free and synchronous. Both locales are bundled, so
 * `t()` never awaits and never returns a placeholder that flashes on screen —
 * the alternative (lazy-loading a locale) would make every label pop from key
 * to text on first paint.
 *
 * A missing key falls back to English rather than rendering the raw key, so a
 * half-translated build degrades to a readable UI instead of showing
 * `settings.providers.title` to a user. `assertLocaleParity` in the tests is
 * what keeps that fallback from quietly becoming the norm.
 */
import { en } from '../locales/en';
import { sv } from '../locales/sv';

export type Locale = 'en' | 'sv';

export const LOCALES: { code: Locale; label: string }[] = [
  // Each language is named in itself — a user who switched to a language they
  // cannot read must still be able to find their way back.
  { code: 'en', label: 'English' },
  { code: 'sv', label: 'Svenska' },
];

const STORAGE_KEY = 'ollama_gui_locale';

type Dict = Record<string, string>;
const DICTS: Record<Locale, Dict> = { en: en as Dict, sv: sv as Dict };

export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'sv';
}

/**
 * The stored preference, or English. Never guesses from navigator.language:
 * the product ships English as its default, and a Swedish OS should not
 * silently change the UI language the user has never chosen.
 */
export function loadLocale(): Locale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isLocale(raw) ? raw : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function saveLocale(locale: Locale): void {
  try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* quota */ }
}

/**
 * Interpolate {name} placeholders. A value that is absent is left as the
 * literal placeholder rather than "undefined", which makes the bug visible in
 * a screenshot instead of shipping a sentence with a hole in it.
 */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole);
}

/** Translate `key` in `locale`, falling back to English, then to the key. */
export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const value = DICTS[locale]?.[key] ?? DICTS.en[key] ?? key;
  return interpolate(value, vars);
}

/** Bind `translate` to one locale — what components receive as `t`. */
export function makeT(locale: Locale) {
  return (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

/** Every key defined in the English dictionary, which is the source of truth. */
export function localeKeys(locale: Locale = 'en'): string[] {
  return Object.keys(DICTS[locale]);
}

export { en, sv };

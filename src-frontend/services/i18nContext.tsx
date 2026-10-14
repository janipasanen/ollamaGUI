/**
 * Locale plumbing for components (#564).
 *
 * Kept apart from services/i18n.ts so that non-React code (services, tests,
 * the boot path) can translate without importing React.
 */
import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { type Locale, DEFAULT_LOCALE, loadLocale, saveLocale, makeT } from './i18n';

export interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

// Defaulting to English rather than throwing keeps a component usable outside
// the provider — notably in unit tests that render one component in isolation.
const I18nContext = createContext<I18nValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: makeT(DEFAULT_LOCALE),
});

export const I18nProvider: React.FC<{ children: React.ReactNode; initial?: Locale }> = ({ children, initial }) => {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? loadLocale());

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    saveLocale(l);
    // Assistive tech and CSS `:lang()` both read this; without it a Swedish UI
    // is still announced as English.
    if (typeof document !== 'undefined') document.documentElement.lang = l;
  }, []);

  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t: makeT(locale) }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

/** Read the active locale and its translator. */
export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

/** Shorthand for the common case of only needing `t`. */
export function useT() {
  return useI18n().t;
}

export default I18nProvider;

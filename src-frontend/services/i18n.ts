/* eslint-disable @typescript-eslint/no-explicit-any */
import enTranslations from '../locales/en.json';
import svTranslations from '../locales/sv.json';

export type Locale = 'en' | 'sv';

var translations: Record<Locale, Record<string, string>> = {
  en: enTranslations,
  sv: svTranslations
};

var currentLocale: Locale = (function() {
  try {
    var stored: string | null = localStorage.getItem('ollama_gui_locale');
    if (stored === 'sv' || stored === 'en') return stored as Locale;
  } catch (e) {}
  if (typeof navigator !== 'undefined' && navigator.language) {
    if (navigator.language.indexOf('sv') === 0) return 'sv';
  }
  return 'en';
})();

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  try { localStorage.setItem('ollama_gui_locale', locale); } catch (e) {}
}

export function t(key: string, params?: Record<string, string | number>): string {
  var dict = translations[currentLocale];
  var value: string = (dict && dict[key]) || translations.en[key] || key;

  if (params) {
    Object.keys(params).forEach(function(k) {
      value = value.replace(new RegExp('\\{' + k + '\\}', 'g'), String(params[k]));
    });
  }

  return value;
}

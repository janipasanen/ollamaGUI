/**
 * Interface language (#564): English by default, Swedish selectable.
 *
 * The parity test is the load-bearing one. A translation system fails quietly
 * — a key added in English and forgotten in Swedish falls back silently, so a
 * Swedish user gets an English sentence in the middle of a Swedish screen and
 * nobody notices until they complain.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  translate, makeT, loadLocale, saveLocale, isLocale,
  DEFAULT_LOCALE, LOCALES, en, sv,
} from '../services/i18n';
import { I18nProvider, useI18n } from '../services/i18nContext';
import ConnectionStatusPanel, { type ProviderStatus } from '../components/ConnectionStatusPanel';

beforeEach(() => localStorage.clear());

describe('locale parity (#564)', () => {
  it('defines exactly the same keys in English and Swedish', () => {
    const enKeys = Object.keys(en).sort();
    const svKeys = Object.keys(sv).sort();
    // Report the difference rather than just a count, so a failure names the
    // key that needs translating.
    expect(svKeys.filter(k => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter(k => !svKeys.includes(k))).toEqual([]);
  });

  it('leaves no Swedish value untranslated or empty', () => {
    const untranslated = Object.keys(en).filter(k => {
      const e = (en as Record<string, string>)[k];
      const s = (sv as Record<string, string>)[k];
      if (!s || !s.trim()) return true;
      // Identical strings are legitimate only for proper nouns and symbols
      // (e.g. "vLLM", "Ollama", "{name}") — flag anything else wordy.
      return s === e && /[a-z]{4,}/.test(e) && !/^[-—\s{}A-Za-z0-9.:+★⚠✓✗📁]*$/.test(e);
    });
    expect(untranslated).toEqual([]);
  });

  it('keeps the same {placeholders} in both languages', () => {
    const ph = (v: string) => (v.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of Object.keys(en)) {
      expect(ph((sv as Record<string, string>)[key]), `placeholders differ for "${key}"`)
        .toEqual(ph((en as Record<string, string>)[key]));
    }
  });
});

describe('translate (#564)', () => {
  it('returns the string for the active locale', () => {
    expect(translate('en', 'providers.title')).toBe('Providers');
    expect(translate('sv', 'providers.title')).toBe('Leverantörer');
  });

  it('interpolates named values', () => {
    expect(translate('en', 'providers.models', { count: 3 })).toBe('3 models');
    expect(translate('sv', 'providers.models', { count: 3 })).toBe('3 modeller');
  });

  it('leaves an unsupplied placeholder visible rather than printing undefined', () => {
    expect(translate('en', 'providers.models')).toBe('{count} models');
  });

  it('falls back to English, then to the key itself', () => {
    // A half-translated build must stay readable, never show a raw key.
    expect(translate('sv', 'definitely.not.a.key')).toBe('definitely.not.a.key');
  });

  it('makeT binds one locale', () => {
    expect(makeT('sv')('sidebar.settings')).toBe('Inställningar');
  });
});

describe('locale persistence (#564)', () => {
  it('defaults to English', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(loadLocale()).toBe('en');
  });

  it('round-trips a saved choice', () => {
    saveLocale('sv');
    expect(loadLocale()).toBe('sv');
  });

  it('ignores a corrupt stored value', () => {
    localStorage.setItem('ollama_gui_locale', 'klingon');
    expect(loadLocale()).toBe('en');
  });

  it('offers both languages, each named in itself', () => {
    expect(LOCALES.map(l => l.code)).toEqual(['en', 'sv']);
    expect(LOCALES.find(l => l.code === 'sv')!.label).toBe('Svenska');
  });

  it('validates locale codes', () => {
    expect(isLocale('sv')).toBe(true);
    expect(isLocale('de')).toBe(false);
  });
});

const Probe: React.FC = () => {
  const { t, locale, setLocale } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="text">{t('providers.title')}</span>
      <button onClick={() => setLocale('sv')}>to-sv</button>
    </div>
  );
};

describe('I18nProvider (#564)', () => {
  it('renders English by default and switches to Swedish', () => {
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId('text').textContent).toBe('Providers');
    fireEvent.click(screen.getByText('to-sv'));
    expect(screen.getByTestId('text').textContent).toBe('Leverantörer');
    expect(screen.getByTestId('locale').textContent).toBe('sv');
  });

  it('persists the switch and reflects it on the document element', () => {
    render(<I18nProvider><Probe /></I18nProvider>);
    fireEvent.click(screen.getByText('to-sv'));
    expect(loadLocale()).toBe('sv');
    expect(document.documentElement.lang).toBe('sv');
  });

  it('starts from the stored locale', () => {
    saveLocale('sv');
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId('text').textContent).toBe('Leverantörer');
  });
});

describe('translated UI renders in Swedish (#564)', () => {
  const provider: ProviderStatus = {
    id: 'v1', name: 'gx10', endpoint: 'http://gx10:8000',
    kind: 'vllm', state: 'connected', modelCount: 2,
  };

  it('shows the providers panel in Swedish', () => {
    render(
      <I18nProvider initial="sv">
        <ConnectionStatusPanel providers={[provider]} onTest={() => {}} onOpenSettings={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByText('Leverantörer')).toBeInTheDocument();
    expect(screen.getByText(/2 modeller/)).toBeInTheDocument();
    expect(screen.getByText('gx10: Ansluten')).toBeInTheDocument();
    expect(screen.getByLabelText('Testa anslutningen till gx10')).toBeInTheDocument();
  });

  it('states the empty case in Swedish', () => {
    render(
      <I18nProvider initial="sv">
        <ConnectionStatusPanel providers={[]} onTest={() => {}} onOpenSettings={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByText(/Inga leverantörer konfigurerade/)).toBeInTheDocument();
  });
});

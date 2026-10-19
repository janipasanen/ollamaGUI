/**
 * Provider status in the sidebar (#563).
 *
 * Replaces the Ollama-only dot that used to sit in the header. The app talks
 * to several kinds of server now — local Ollama, a remote Ollama, an
 * OpenAI-compatible endpoint, vLLM — so "are we connected?" is a per-provider
 * question, and a single header dot could only ever answer it for one of them.
 *
 * Deliberately compact: one row per provider, the same visual weight as a
 * project row, so the sidebar gains information without gaining chrome.
 */
import React from 'react';
import { useT } from '../services/i18nContext';

export type ProviderState = 'connected' | 'disconnected' | 'testing' | 'unknown';

export interface ProviderStatus {
  /** Stable key. The built-in local daemon uses the reserved id 'local'. */
  id: string;
  name: string;
  /** Shown under the name — host:port, trimmed of its scheme. */
  endpoint: string;
  /** Provider type, rendered as a short badge. */
  kind: 'ollama' | 'openai' | 'vllm';
  state: ProviderState;
  /** Model count when known; omitted while unknown. */
  modelCount?: number;
  /** True when the user has switched this provider off in Settings. */
  disabled?: boolean;
}

export interface ConnectionStatusPanelProps {
  providers: ProviderStatus[];
  onTest: (id: string) => void;
  onOpenSettings: () => void;
  dark?: boolean;
}

/** Strip the scheme so the row stays readable at sidebar width. */
export function shortEndpoint(endpoint: string): string {
  return endpoint.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

type T = (key: string, vars?: Record<string, string | number>) => string;

function dotClass(state: ProviderState, disabled?: boolean): string {
  if (disabled) return 'bg-zinc-500';
  switch (state) {
    case 'connected': return 'bg-emerald-500';
    case 'disconnected': return 'bg-red-500';
    case 'testing': return 'bg-amber-400 animate-pulse';
    default: return 'bg-zinc-400';
  }
}

function stateLabel(t: T, state: ProviderState, disabled?: boolean): string {
  if (disabled) return t('providers.state.off');
  switch (state) {
    case 'connected': return t('providers.state.connected');
    case 'disconnected': return t('providers.state.disconnected');
    case 'testing': return t('providers.state.testing');
    default: return t('providers.state.unknown');
  }
}

export const ConnectionStatusPanel: React.FC<ConnectionStatusPanelProps> = ({
  providers, onTest, onOpenSettings, dark,
}) => {
  const t = useT();
  return (
    <div className={`mt-2 border-t pt-2 ${dark ? 'border-zinc-800' : 'border-zinc-200'}`}>
      <p className={`text-xs uppercase font-semibold mb-1 px-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
        {t('providers.title')}
      </p>

      {providers.length === 0 ? (
        <button
          onClick={onOpenSettings}
          className={`w-full text-left text-xs italic px-1 py-1 rounded ${
            dark ? 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100'
          }`}
        >
          {t('providers.none')}
        </button>
      ) : (
        <ul className="space-y-0.5">
          {providers.map(p => (
            <li
              key={p.id}
              className={`group flex items-center gap-2 px-1 py-1 rounded ${
                dark ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'
              }`}
            >
              <span
                aria-hidden="true"
                className={`w-2 h-2 rounded-full shrink-0 ${dotClass(p.state, p.disabled)}`}
              />
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className={`text-xs truncate ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>{p.name}</span>
                  <span className={`text-[9px] px-1 rounded shrink-0 ${dark ? 'bg-zinc-800 text-zinc-500' : 'bg-zinc-200 text-zinc-500'}`}>
                    {t(`providers.kind.${p.kind}`)}
                  </span>
                </span>
                <span
                  className={`block text-[10px] font-mono truncate ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}
                  // The full endpoint is available on hover even when truncated.
                  title={p.endpoint}
                >
                  {shortEndpoint(p.endpoint)}
                  {typeof p.modelCount === 'number' && p.modelCount > 0
                    ? ` · ${t(p.modelCount === 1 ? 'providers.model' : 'providers.models', { count: p.modelCount })}`
                    : ''}
                </span>
              </span>
              {/* The status is what a screen reader needs; the dot is decorative. */}
              <span className="sr-only">{`${p.name}: ${stateLabel(t, p.state, p.disabled)}`}</span>
              <button
                onClick={() => onTest(p.id)}
                disabled={p.state === 'testing'}
                aria-label={t('providers.testConnection', { name: p.name })}
                title={stateLabel(t, p.state, p.disabled)}
                className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50 ${
                  dark ? 'border-zinc-700 text-zinc-400 hover:bg-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-200'
                }`}
              >
                {p.state === 'testing' ? '…' : t('providers.test')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ConnectionStatusPanel;

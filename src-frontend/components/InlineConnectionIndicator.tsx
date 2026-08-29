import React from 'react';

/**
 * Inline Ollama connection indicator (#547).
 *
 * Replaces the bare colored dot + hover `title` (which only revealed the
 * endpoint/status on hover). Shows the live status and endpoint inline so the
 * answer to "am I connected, to what" is always legible without interaction.
 */

export type ConnectionState = 'connected' | 'disconnected' | 'unknown';

/** Pure helper: the always-legible status label for a connection state. */
export function connectionStatusLabel(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return 'Connected';
    case 'disconnected':
      return 'Disconnected';
    default:
      return 'Connection unknown';
  }
}

/** Pure helper: truncate a bare host+port for inline display. */
export function shortEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return trimmed.length > 28 ? `${trimmed.slice(0, 26)}…` : trimmed;
}

interface Props {
  connected: boolean | null;
  baseUrl: string;
  dark: boolean;
  /** Optional override for the inline label text (tests). */
  labelOverride?: string;
}

const DOT: Record<ConnectionState, string> = {
  connected: 'bg-emerald-500',
  disconnected: 'bg-red-500',
  unknown: 'bg-zinc-400',
};

export const InlineConnectionIndicator: React.FC<Props> = ({
  connected,
  baseUrl,
  dark,
  labelOverride,
}) => {
  const state: ConnectionState =
    connected === null ? 'unknown' : connected ? 'connected' : 'disconnected';
  const label = labelOverride ?? connectionStatusLabel(state);
  const endpoint = shortEndpoint(baseUrl);

  return (
    <span
      aria-label={`Ollama connection: ${label}${endpoint ? ` · ${endpoint}` : ''}`}
      data-testid="inline-connection-indicator"
      className="flex items-center shrink-0 gap-1.5 text-[10px] font-medium whitespace-nowrap"
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[state]}`} />
      <span className={`truncate max-w-[12rem] ${dark ? 'text-zinc-300' : 'text-zinc-700'}`}>
        {label}
        {endpoint ? ` · ${endpoint}` : ''}
      </span>
    </span>
  );
};

export default InlineConnectionIndicator;

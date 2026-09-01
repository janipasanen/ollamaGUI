import React, { useState, useCallback } from 'react';
import type { ConnectionHealth, ConnectedModel, ModelConnection } from '../services/connections';
import { checkConnectionHealth } from '../services/connections';

interface Props {
  connections: ModelConnection[];
  connectedModels: ConnectedModel[];
  onOpenProviderConfig: () => void;
  dark: boolean;
}

type HealthStatus = 'healthy' | 'unreachable' | 'authError' | 'testing';

const STATUS_META: Record<
  HealthStatus,
  { dot: string; label: string; color: string }
> = {
  healthy: { dot: 'bg-emerald-500', label: 'Connected', color: 'text-emerald-500' },
  unreachable: { dot: 'bg-red-500', label: 'Disconnected', color: 'text-red-500' },
  authError: { dot: 'bg-amber-500', label: 'Auth error', color: 'text-amber-500' },
  testing: { dot: 'bg-blue-500', label: 'Testing…', color: 'text-blue-500' },
};

function shortEndpoint(url: string): string {
  const trimmed = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return trimmed.length > 20 ? `${trimmed.slice(0, 18)}…` : trimmed;
}

export const ConnectionStatusPanel: React.FC<Props> = ({
  connections,
  connectedModels,
  onOpenProviderConfig,
  dark,
}) => {
  const [health, setHealth] = useState<Record<string, HealthStatus>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const handleTest = useCallback(async (id: string) => {
    const conn = connections.find(c => c.id === id);
    if (!conn) return;
    setTestingId(id);
    try {
      const result = await checkConnectionHealth(conn);
      setHealth(prev => ({
        ...prev,
        [id]: result.status as HealthStatus,
      }));
    } catch {
      setHealth(prev => ({ ...prev, [id]: 'unreachable' }));
    } finally {
      setTestingId(null);
    }
  }, [connections]);

  // Auto-probe all connections on mount (non-blocking)
  React.useEffect(() => {
    let cancelled = false;
    connections.forEach(conn => {
      checkConnectionHealth(conn)
        .then(result => {
          if (cancelled) return;
          setHealth(prev => ({ ...prev, [conn.id]: result.status as HealthStatus }));
        })
        .catch(() => {
          if (cancelled) return;
          setHealth(prev => ({ ...prev, [conn.id]: 'unreachable' }));
        });
    });
    return () => { cancelled = true; };
  }, [connections]);

  if (connections.length === 0) {
    return (
      <div className={`px-2 py-2 mb-2 rounded-lg border ${dark ? 'bg-zinc-900/50 border-zinc-800' : 'bg-zinc-50 border-zinc-200'}`}>
        <p className={`text-[10px] font-medium mb-1 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>PROVIDERS</p>
        <p className={`text-xs italic ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>
          No providers configured
        </p>
        <button
          onClick={onOpenProviderConfig}
          className={`text-[10px] underline mt-1 ${dark ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-600'}`}
        >
          Add a provider →
        </button>
      </div>
    );
  }

  return (
    <div className={`px-2 py-2 mb-2 rounded-lg border ${dark ? 'bg-zinc-900/50 border-zinc-800' : 'bg-zinc-50 border-zinc-200'}`}>
      <p className={`text-[10px] font-medium mb-1.5 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>PROVIDERS</p>
      <div className="space-y-1">
        {connections.map(conn => {
          const status = health[conn.id] ?? 'testing';
          const meta = STATUS_META[status];
          const hasModels = connectedModels.some(m => m.connectionId === conn.id);
          return (
            <div
              key={conn.id}
              className={`flex items-center gap-1.5 text-xs rounded-md px-1.5 py-1 ${
                dark ? 'hover:bg-zinc-800/60' : 'hover:bg-zinc-100'
              }`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${meta.dot}`} />
              <span className={`flex-1 min-w-0 truncate ${meta.color}`}>
                {conn.name}
              </span>
              {status === 'healthy' && hasModels && (
                <span className={`text-[9px] ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                  ({connectedModels.filter(m => m.connectionId === conn.id).length})
                </span>
              )}
              <button
                onClick={() => handleTest(conn.id)}
                disabled={testingId === conn.id}
                className={`shrink-0 px-1 py-0.5 text-[9px] rounded ${
                  dark
                    ? 'text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800'
                    : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200'
                } ${testingId === conn.id ? 'opacity-50' : ''}`}
                aria-label={`Test connection ${conn.name}`}
                title={meta.label}
              >
                {status === 'healthy' ? '✓' : status === 'testing' ? '…' : '↻'}
              </button>
            </div>
          );
        })}
      </div>
      <button
        onClick={onOpenProviderConfig}
        className={`text-[10px] underline mt-1.5 w-full text-left ${dark ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-600'}`}
      >
        Manage providers →
      </button>
    </div>
  );
};

export default ConnectionStatusPanel;

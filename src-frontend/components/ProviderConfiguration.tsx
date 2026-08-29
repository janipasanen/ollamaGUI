/**
 * Provider configuration modal (#554).
 *
 * Allows users to add, edit, and remove provider connections directly in the UI.
 * Also manages context window configuration for each model/connection.
 */

import React, { useState } from 'react';
import type { ConnectionHealth, ConnectedModel, ModelConnection } from '../services/connections';
import { checkConnectionHealth } from '../services/connections';
import { uuid } from '../services/uuid';
import {
  loadModelContextConfigs,
  saveModelContextConfigs,
  getModelDefaultContext,
  detectContextWindow,
} from '../services/modelContextConfig';

type HealthByConn = Record<string, ConnectionHealth>;

type HealthStatus = 'healthy' | 'unreachable' | 'authError';

const HEALTH_META: Record<
  HealthStatus,
  { label: string; dot: string; text: string; bg: string }
> = {
  healthy: { label: 'Healthy', dot: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-100' },
  unreachable: { label: 'Unreachable', dot: 'bg-red-500', text: 'text-red-600', bg: 'bg-red-100' },
  authError: { label: 'Auth error', dot: 'bg-amber-500', text: 'text-amber-600', bg: 'bg-amber-100' },
};

/** The status shown while a "Test" probe is in flight for a connection. */
function statusPill(status: ConnectionHealth['status'], dark: boolean, busy: boolean) {
  const meta = HEALTH_META[status];
  const cls = `${meta.bg} ${meta.text} text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1`;
  return (
    <span className={cls} data-testid={`health-pill-${status}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {busy ? `Testing…` : meta.label}
    </span>
  );
}

interface Props {
  dark: boolean;
  connections: ModelConnection[];
  connectedModels: ConnectedModel[];
  onSave: (connections: ModelConnection[]) => void;
  onClose: () => void;
}

export const ProviderConfiguration: React.FC<Props> = ({
  dark,
  connections,
  connectedModels,
  onSave,
  onClose,
}) => {
  const [editingConn, setEditingConn] = useState<ModelConnection | null>(null);
  const [newConn, setNewConn] = useState({ name: '', kind: 'openai' as 'openai' | 'ollama', baseUrl: '', apiKey: '', defaultModel: '' });
  
  // Context window configurations per model (loaded once)
  const [contextConfigs, setContextConfigs] = useState<Map<string, any>>(() => loadModelContextConfigs());

  // Per-connection health results (G5: Connection Health Status). Keyed by
  // connection id so the pill reflects the latest probe for each provider.
  const [health, setHealth] = useState<HealthByConn>({});
  const [testingConn, setTestingConn] = useState<string | null>(null);

  // Per-model context windows auto-detected this session, keyed by the storage
  // model id ("connectionId/modelName"). Backing for the "Detect context"
  // affordance (G9: context window tuning).
  const [detectedWindows, setDetectedWindows] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [detecting, setDetecting] = useState<string | null>(null);

  // Probe a single provider's health. Retries once after a short wait so a
  // transient offline blip isn't reported as down.
  const handleTestConnection = async (id: string) => {
    const target = connections.find((c) => c.id === id);
    if (!target) return;
    setTestingConn(id);
    try {
      const result = await checkConnectionHealth(target);
      setHealth((prev) => ({ ...prev, [id]: result }));
    } catch {
      setHealth((prev) => ({
        ...prev,
        [id]: { connectionId: id, status: 'unreachable', detail: 'Probe failed' },
      }));
    } finally {
      setTestingConn(null);
    }
  };

  // Detect the context window for every connected model on a connection and
  // persist the results under model_context_config_v1 (G9: context window
  // tuning). Detects only models that share this connection; the connection
  // base URL comes from `connections`.
  const detectContextForModel = async (id: string) => {
    setDetecting(id);
    try {
      const target = connections.find((c) => c.id === id);
      if (!target) return;
      const models = connectedModels.filter((m) => m.connectionId === id);
      await Promise.all(
        models.map(async (m) => {
          const key = `${m.connectionId}/${m.name}`;
          const detected = await detectContextWindow(
            target.baseUrl,
            m.connectionId,
            m.name,
          );
          if (typeof detected === 'number' && detected > 0) {
            setDetectedWindows((prev) => new Map(prev).set(key, detected));
          }
        }),
      );
    } catch {
      // Detection failures are non-fatal; nothing is persisted on error.
    } finally {
      setDetecting(null);
    }
  };

  const handleAddConnection = () => {
    if (!newConn.name || !newConn.baseUrl) return;
    
    const conn: ModelConnection = {
      id: uuid(),
      name: newConn.name,
      kind: newConn.kind,
      baseUrl: newConn.baseUrl.replace(/\/+$/, ''),
      apiKey: newConn.apiKey.trim() || undefined,
      enabled: true,
      defaultModel: newConn.defaultModel || undefined,
    };
    
    onSave([...connections, conn]);
    setNewConn({ name: '', kind: 'openai', baseUrl: '', apiKey: '', defaultModel: '' });
  };

  const handleEditConnection = (conn: ModelConnection) => {
    setEditingConn(conn);
  };

  const handleSaveEdit = () => {
    if (!editingConn) return;
    
    onSave(connections.map(c => c.id === editingConn.id ? editingConn : c));
    setEditingConn(null);
  };

  const handleDeleteConnection = (id: string) => {
    onSave(connections.filter(c => c.id !== id));
  };

  const handleToggleEnabled = (id: string, enabled: boolean) => {
    onSave(connections.map(c => c.id === id ? { ...c, enabled } : c));
  };

  // Update context config for a specific model in a connection
  const updateContextConfig = (modelId: string, newConfig: Partial<{contextWindow: number}>) => {
    const updated = new Map(contextConfigs);
    const existing = updated.get(modelId) ?? { contextWindow: getModelDefaultContext(), autoDetected: false };
    updated.set(modelId, { ...existing, ...newConfig });
    setContextConfigs(updated);
  };

  // Save all context configs when closing the modal
  const handleSaveAndClose = () => {
    saveModelContextConfigs(contextConfigs);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-lg rounded-xl shadow-2xl ${dark ? 'bg-zinc-900 border border-zinc-700' : 'bg-white border border-zinc-300'} p-6`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-lg font-semibold ${dark ? 'text-zinc-100' : 'text-zinc-900'}`}>
            Provider Configuration
          </h2>
          <button
            type="button"
            aria-label="Close provider settings"
            onClick={handleSaveAndClose}
            className={`p-1 rounded ${dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'}`}
          >
            ✕
          </button>
        </div>

        {/* Context Window Instructions */}
        <div className={`mb-4 p-3 rounded-lg text-xs ${dark ? 'bg-blue-900/20 text-zinc-300' : 'bg-blue-50 text-zinc-700'}`}>
          <strong>Context Window Configuration:</strong> Configure context windows for your local models. Remote models will auto-detect their limits.
        </div>

        {/* Connection list */}
        <div className="max-h-96 overflow-y-auto mb-6 space-y-3">
          {connections.length === 0 ? (
            <p className={`text-center py-4 text-sm ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
              No provider connections configured. Add one below.
            </p>
          ) : (
            connections.map(conn => (
              <div
                key={conn.id}
                className={`rounded-lg p-3 border ${
                  dark ? 'bg-zinc-800/50 border-zinc-700' : 'bg-zinc-50 border-zinc-200'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className={`font-medium ${dark ? 'text-zinc-200' : 'text-zinc-800'}`}>
                      {conn.name}
                    </div>
                    <div className={`text-xs mt-1 font-mono ${dark ? 'text-zinc-500' : 'text-zinc-600'}`}>
                      {conn.baseUrl} ({conn.kind})
                    </div>
                    {conn.apiKey && (
                      <div className={`text-[10px] mt-0.5 ${dark ? 'text-emerald-600' : 'text-emerald-700'}`}>
                        🔑 API key configured
                      </div>
                    )}
                    {/* G5: per-provider connection health pill */}
                    {health[conn.id] && (
                      <div className="mt-1">
                        {statusPill(
                          health[conn.id].status,
                          dark,
                          testingConn === conn.id,
                        )}
                        {health[conn.id].detail && (
                          <div
                            className={`text-[10px] mt-0.5 ${
                              dark ? 'text-zinc-500' : 'text-zinc-400'
                            }`}
                            title={health[conn.id].detail}
                          >
                            {health[conn.id].detail}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      aria-label={`Test ${conn.name} connection`}
                      data-testid={`test-btn-${conn.id}`}
                      disabled={testingConn !== null && testingConn !== conn.id}
                      onClick={() => handleTestConnection(conn.id)}
                      title="Test connection"
                      className={`px-2 py-1 text-[10px] rounded ${
                        dark
                          ? 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600'
                          : 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300'
                      }`}
                    >
                      Test
                    </button>
                    {/* Context window info for local models */}
                    {conn.kind === 'ollama' && (
                      <div className={`text-[10px] ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                        📏 Default: ~{Math.round(getModelDefaultContext() / 1024)}k tokens
                      </div>
                    )}
                    {/* G9: per-connection auto-detect context window affordance */}
                    {connectedModels.filter((m) => m.connectionId === conn.id).length > 0 && (
                      <button
                        type="button"
                        aria-label={`Auto-detect context windows for ${conn.name}`}
                        data-testid={`detect-btn-${conn.id}`}
                        onClick={() => detectContextForModel(conn.id)}
                        disabled={detecting !== null}
                        title="Auto-detect context window for each model from its server"
                        className={`px-2 py-1 text-[10px] rounded ${
                          dark
                            ? 'bg-purple-700 text-purple-100 hover:bg-purple-600'
                            : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                        }`}
                      >
                        {detecting === conn.id ? 'Detecting…' : 'Detect context'}
                      </button>
                    )}
                    {connectedModels
                      .filter((m) => m.connectionId === conn.id && detectedWindows.has(`${m.connectionId}/${m.name}`))
                      .map((m) => {
                        const detected = detectedWindows.get(`${m.connectionId}/${m.name}`);
                        return detected ? (
                          <div className={`text-[10px] ${dark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                            🧠 {m.name}: {detected.toLocaleString()} tokens
                          </div>
                        ) : null;
                      })}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={conn.enabled ? 'Disable provider' : 'Enable provider'}
                        onClick={() => handleToggleEnabled(conn.id, !conn.enabled)}
                        title={conn.enabled ? 'Disable' : 'Enable'}
                        className={`px-2 py-1 text-[10px] rounded ${
                          conn.enabled
                            ? dark ? 'bg-emerald-900/30 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                            : dark ? 'bg-zinc-700 text-zinc-400' : 'bg-zinc-200 text-zinc-500'
                        }`}
                      >
                        {conn.enabled ? 'On' : 'Off'}
                      </button>
                      <button
                        type="button"
                        aria-label="Edit provider"
                        onClick={() => handleEditConnection(conn)}
                        title="Edit"
                        className={`p-1.5 rounded ${
                          dark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'
                        }`}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        aria-label="Delete provider"
                        onClick={() => handleDeleteConnection(conn.id)}
                        title="Delete"
                        className={`p-1.5 rounded ${
                          dark ? 'hover:bg-red-900/30 text-red-400' : 'hover:bg-red-50 text-red-600'
                        }`}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add or edit connection */}
        <div className={`rounded-lg p-4 border ${dark ? 'bg-zinc-800/30 border-zinc-700' : 'bg-zinc-50 border-zinc-200'}`}>
          <h3 className={`text-sm font-medium mb-3 ${dark ? 'text-zinc-200' : 'text-zinc-800'}`}>
            {editingConn ? 'Edit Provider' : 'Add New Provider'}
          </h3>

          {editingConn ? (
            <ProviderEditForm
              dark={dark}
              conn={editingConn}
              updater={patch => setEditingConn(prev => (prev ? { ...prev, ...patch } : prev))}
              onSave={handleSaveEdit}
              onCancel={() => setEditingConn(null)}
            />
          ) : (
            <ProviderAddForm
              dark={dark}
              newConn={newConn}
              updater={patch => setNewConn(prev => ({ ...prev, ...patch }))}
              onSave={handleAddConnection}
            />
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Fields shared by the Add / Edit provider forms.
 */
function ProviderFormFields({
  dark,
  newConn,
  updater,
}: {
  dark: boolean;
  newConn: { name: string; kind: 'openai' | 'ollama'; baseUrl: string; apiKey: string; defaultModel: string };
  updater: (patch: Partial<typeof newConn>) => void;
}) {
  const input = 'w-full rounded px-2 py-1.5 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 ' +
    (dark ? 'bg-zinc-900 border-zinc-600 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-700');

  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder="Provider name (e.g., LM Studio)"
        value={newConn.name}
        onChange={e => updater({ name: e.target.value })}
        className={input}
      />

      <div className="flex gap-2">
        <select
          value={newConn.kind}
          onChange={e => updater({ kind: e.target.value as 'openai' | 'ollama' })}
          className={`flex-1 rounded px-2 py-1.5 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            dark ? 'bg-zinc-900 border-zinc-600 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-700'
          }`}
        >
          <option value="openai">OpenAI-compatible (LM Studio, etc.)</option>
          <option value="ollama">Ollama server</option>
        </select>

        <input
          type="text"
          placeholder="API Key (optional)"
          value={newConn.apiKey}
          onChange={e => updater({ apiKey: e.target.value })}
          className={`w-1/3 rounded px-2 py-1.5 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            dark ? 'bg-zinc-900 border-zinc-600 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-700'
          }`}
        />
      </div>

      <input
        type="text"
        placeholder="Base URL (e.g., http://localhost:1234)"
        value={newConn.baseUrl}
        onChange={e => updater({ baseUrl: e.target.value })}
        className={input}
      />

      <input
        type="text"
        placeholder="Default model tag (optional)"
        value={newConn.defaultModel}
        onChange={e => updater({ defaultModel: e.target.value })}
        className={input}
      />
    </div>
  );
}

/** Add-new-provider form. Saves on Enter only when name + baseUrl are present. */
function ProviderAddForm({
  dark,
  newConn,
  updater,
  onSave,
}: {
  dark: boolean;
  newConn: { name: string; kind: 'openai' | 'ollama'; baseUrl: string; apiKey: string; defaultModel: string };
  updater: (patch: Partial<typeof newConn>) => void;
  onSave: () => void;
}) {
  return (
    <>
      <ProviderFormFields dark={dark} newConn={newConn} updater={updater} />
      <button
        onClick={onSave}
        disabled={!newConn.name || !newConn.baseUrl}
        className={`w-full py-2 rounded-lg font-medium transition-colors ${
          newConn.name && newConn.baseUrl
            ? 'bg-blue-600 hover:bg-blue-500 text-white'
            : dark ? 'bg-zinc-700 text-zinc-400' : 'bg-zinc-300 text-zinc-500'
        }`}
      >
        Add Provider
      </button>
    </>
  );
}

/** Edit-existing-provider form. Cancel removes the temp edit. */
function ProviderEditForm({
  dark,
  conn,
  updater,
  onSave,
  onCancel,
}: {
  dark: boolean;
  conn: ModelConnection;
  updater: (patch: Partial<ModelConnection>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3">
      <ProviderFormFields
        dark={dark}
        newConn={{
          name: conn.name,
          kind: conn.kind,
          baseUrl: conn.baseUrl,
          apiKey: conn.apiKey ?? '',
          defaultModel: conn.defaultModel ?? '',
        }}
        updater={updater}
      />
      <div className="flex gap-2">
        <button
          onClick={onSave}
          className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
            dark ? 'bg-emerald-700 hover:bg-emerald-600 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          }`}
        >
          Save Changes
        </button>
        <button
          onClick={onCancel}
          className={`py-2 px-4 rounded-lg font-medium transition-colors ${
            dark ? 'bg-zinc-700 hover:bg-zinc-600 text-white' : 'bg-zinc-300 hover:bg-zinc-400 text-zinc-700'
          }`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default ProviderConfiguration;

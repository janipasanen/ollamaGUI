/**
 * Provider configuration modal (#554).
 *
 * Allows users to add, edit, and remove provider connections directly in the UI.
 */

import React, { useState } from 'react';
import type { ModelConnection } from '../services/connections';

interface Props {
  dark: boolean;
  connections: ModelConnection[];
  onSave: (connections: ModelConnection[]) => void;
  onClose: () => void;
}

export const ProviderConfiguration: React.FC<Props> = ({ dark, connections, onSave, onClose }) => {
  const [editingConn, setEditingConn] = useState<ModelConnection | null>(null);
  const [newConn, setNewConn] = useState({ name: '', kind: 'openai' as 'openai' | 'ollama', baseUrl: '', apiKey: '' });

  const handleAddConnection = () => {
    if (!newConn.name || !newConn.baseUrl) return;
    
    const conn: ModelConnection = {
      id: crypto.randomUUID(),
      name: newConn.name,
      kind: newConn.kind,
      baseUrl: newConn.baseUrl.replace(/\/+$/, ''),
      apiKey: newConn.apiKey.trim() || undefined,
      enabled: true,
    };
    
    onSave([...connections, conn]);
    setNewConn({ name: '', kind: 'openai', baseUrl: '', apiKey: '' });
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
            onClick={onClose}
            className={`p-1 rounded ${dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'}`}
          >
            ✕
          </button>
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
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleEnabled(conn.id, !conn.enabled)}
                      title={conn.enabled ? "Disable" : "Enable"}
                      className={`px-2 py-1 text-[10px] rounded ${
                        conn.enabled
                          ? dark ? 'bg-emerald-900/30 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                          : dark ? 'bg-zinc-700 text-zinc-400' : 'bg-zinc-200 text-zinc-500'
                      }`}
                    >
                      {conn.enabled ? 'On' : 'Off'}
                    </button>
                    <button
                      onClick={() => handleEditConnection(conn)}
                      className={`p-1.5 rounded ${
                        dark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-zinc-200 text-zinc-600'
                      }`}
                      title="Edit"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDeleteConnection(conn.id)}
                      className={`p-1.5 rounded ${
                        dark ? 'hover:bg-red-900/30 text-red-400' : 'hover:bg-red-50 text-red-600'
                      }`}
                      title="Delete"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add new connection */}
        <div className={`rounded-lg p-4 border ${dark ? 'bg-zinc-800/30 border-zinc-700' : 'bg-zinc-50 border-zinc-200'}`}>
          <h3 className={`text-sm font-medium mb-3 ${dark ? 'text-zinc-200' : 'text-zinc-800'}`}>
            Add New Provider
          </h3>
          
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Provider name (e.g., LM Studio)"
              value={newConn.name}
              onChange={e => setNewConn(v => ({ ...v, name: e.target.value }))}
              className={`w-full rounded px-2 py-1.5 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                dark ? 'bg-zinc-900 border-zinc-600 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-700'
              }`}
            />
            
            <div className="flex gap-2">
              <select
                value={newConn.kind}
                onChange={e => setNewConn(v => ({ ...v, kind: e.target.value as 'openai' | 'ollama' }))}
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
                onChange={e => setNewConn(v => ({ ...v, apiKey: e.target.value }))}
                className={`w-1/3 rounded px-2 py-1.5 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  dark ? 'bg-zinc-900 border-zinc-600 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-700'
                }`}
              />
            </div>
            
            <input
              type="text"
              placeholder="Base URL (e.g., http://localhost:1234)"
              value={newConn.baseUrl}
              onChange={e => setNewConn(v => ({ ...v, baseUrl: e.target.value }))}
              className={`w-full rounded px-2 py-1.5 text-sm border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                dark ? 'bg-zinc-900 border-zinc-600 text-zinc-100' : 'bg-white border-zinc-300 text-zinc-700'
              }`}
            />
            
            <button
              onClick={handleAddConnection}
              disabled={!newConn.name || !newConn.baseUrl}
              className={`w-full py-2 rounded-lg font-medium transition-colors ${
                newConn.name && newConn.baseUrl
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : dark ? 'bg-zinc-700 text-zinc-400' : 'bg-zinc-300 text-zinc-500'
              }`}
            >
              Add Provider
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProviderConfiguration;

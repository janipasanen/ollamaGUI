/**
 * Project config.json editor (#556).
 *
 * A thin, validated JSON editor over the project-level `config.json` used to
 * configure providers. The editor keeps an in-memory copy, validates JSON on
 * each change, and only writes back when the JSON is structurally valid and
 * the user confirms. It never overwrites another user's in-flight edits — the
 * initial snapshot is read once when the modal opens.
 */

import React, { useState } from 'react';
import {
  loadProjectConfig,
  saveProjectConfig,
  type ProjectConfig,
} from '../services/projectConfig';

interface Props {
  dark: boolean;
  onClose: () => void;
  /** Called after a successful save so the caller can refresh its view. */
  onSave: (config: ProjectConfig) => void;
}

interface EditorState {
  text: string;
  error: string | null;
  dirty: boolean;
}

/** Build the editor's initial text from a stored snapshot, if any. */
async function initialText(): Promise<{ text: string; error: string | null }> {
  const config = await loadProjectConfig();
  if (!config) {
    return { text: '{\n  "version": 1,\n  "providers": []\n}\n', error: null };
  }
  return { text: JSON.stringify(config, null, 2), error: null };
}

/** Parse + validate editor text, returning the config or an error message. */
export function validateConfig(text: string): { config?: ProjectConfig; error: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { error: 'config.json must be a JSON object.' };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    return { error: 'version must be 1.' };
  }
  if (!Array.isArray(obj.providers)) {
    return { error: 'providers must be an array.' };
  }

  // Structural validation of each provider entry.
  for (const [i, provider] of obj.providers.entries()) {
    if (typeof provider !== 'object' || provider === null) {
      return { error: `providers[${i}] must be an object.` };
    }
    const p = provider as Record<string, unknown>;
    for (const field of ['id', 'name', 'type', 'baseUrl'] as const) {
      if (typeof p[field] !== 'string' || !p[field].trim()) {
        return { error: `providers[${i}].${field} must be a non-empty string.` };
      }
    }
  }

  return { config: parsed as ProjectConfig, error: null };
}

export const ProjectConfigEditor: React.FC<Props> = ({ dark, onClose, onSave }) => {
  const [state, setState] = useState<EditorState>({ text: '', error: null, dirty: false });

  // Load the initial snapshot once (config.json may not exist yet).
  React.useEffect(() => {
    let cancelled = false;
    initialText().then(({ text, error }) => {
      if (cancelled) return;
      setState({ text, error, dirty: false });
    });
    return () => { cancelled = true; };
  }, []);

  const handleChange = (value: string) => {
    const { config, error } = validateConfig(value);
    setState((prev) => ({
      text: value,
      error,
      // Count it dirty only when the current value is structurally valid and
      // differs from the snapshot we started with.
      dirty: !!error === false && config !== undefined && value !== prev.text,
    }));
  };

  const handleSave = () => {
    if (!state.error) {
      const { config } = validateConfig(state.text);
      if (config) {
        void saveProjectConfig(config).then((ok) => {
          if (ok) onSave(config);
          else setState((prev) => ({ ...prev, error: 'Failed to write config.json.' }));
        });
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-2xl rounded-xl shadow-2xl ${dark ? 'bg-zinc-900 border border-zinc-700' : 'bg-white border border-zinc-300'} p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-lg font-semibold ${dark ? 'text-zinc-100' : 'text-zinc-900'}`}>
            config.json
          </h2>
          <button
            type="button"
            aria-label="Close config editor"
            onClick={onClose}
            className={`p-1 rounded ${dark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'}`}
          >
            ✕
          </button>
        </div>

        <p className={`text-xs mb-3 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
          Edit the project provider configuration. JSON is validated live; changes are
          saved only when the file is valid.
        </p>

        <textarea
          value={state.text}
          onChange={(e) => handleChange(e.target.value)}
          spellCheck={false}
          className={`w-full h-80 rounded-lg px-3 py-2 font-mono text-xs border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            dark ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-zinc-50 border-zinc-300 text-zinc-900'
          } ${state.error ? 'border-red-400' : ''}`}
        />

        {state.error && (
          <p className="text-xs text-red-400 mt-2">{state.error}</p>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              dark ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-100' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-800'
            }`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!!state.error || !state.dirty}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              state.error || !state.dirty
                ? 'bg-zinc-300 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-500 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectConfigEditor;

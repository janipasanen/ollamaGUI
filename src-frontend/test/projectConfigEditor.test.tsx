/**
 * ProjectConfigEditor (#556) — the config.json JSON editor + validateConfig.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { validateConfig } from '../components/ProjectConfigEditor';
import ProjectConfigEditor from '../components/ProjectConfigEditor';

const validConfig = {
  version: 1,
  providers: [
    { id: 'local-ollama', name: 'Local Ollama', type: 'ollama', baseUrl: 'http://localhost:11434' },
  ],
};

describe('validateConfig (#556)', () => {
  it('accepts a structurally valid config', () => {
    const { config, error } = validateConfig(JSON.stringify(validConfig));
    expect(error).toBeNull();
    expect(config?.version).toBe(1);
    expect(config?.providers).toHaveLength(1);
  });

  it('rejects malformed JSON', () => {
    const { error } = validateConfig('{ not json');
    expect(error).toMatch(/Invalid JSON/);
  });

  it('rejects a non-object root', () => {
    const { error } = validateConfig('42');
    expect(error).toMatch(/must be a JSON object/);
  });

  it('rejects a missing version field', () => {
    const { error } = validateConfig(JSON.stringify({ providers: [] }));
    expect(error).toMatch(/version must be 1/);
  });

  it('rejects a non-array providers field', () => {
    const { error } = validateConfig(JSON.stringify({ version: 1, providers: {} }));
    expect(error).toMatch(/providers must be an array/);
  });

  it('rejects a provider missing required fields', () => {
    const { error } = validateConfig(JSON.stringify({
      version: 1,
      providers: [{ id: 'x', name: 'y' }],
    }));
    expect(error).toMatch(/must be a non-empty string/);
  });
});

function renderEditor(overrides: {
  onSave?: (config: any) => void;
  onClose?: () => void;
}) {
  const onSave = vi.fn(overrides.onSave ?? (() => {}));
  const onClose = vi.fn(overrides.onClose ?? (() => {}));
  const utils = render(
    <ProjectConfigEditor dark={false} onClose={onClose} onSave={onSave} />
  );
  return { onSave, onClose, ...utils };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  // Initial load returns non-ok → empty scaffold; save POST resolves ok.
  global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' }) as never;
});

describe('ProjectConfigEditor (#556)', () => {
  it('renders with Save disabled until the user makes a valid edit', () => {
    renderEditor({});
    expect(screen.getByRole('heading', { name: 'config.json' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('Save stays disabled while JSON is invalid', () => {
    const { } = renderEditor({});
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '{ broken' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('enables Save once the textarea holds valid JSON', () => {
    renderEditor({});
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: JSON.stringify(validConfig) } });
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
  });

  it('onSave fires with the parsed config on a valid save', () => {
    const { onSave } = renderEditor({});
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: JSON.stringify(validConfig) },
    });
    // handleSave awaits saveProjectConfig (a fetch) before calling onSave,
    // so flush microtasks inside act().
    return act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    }).then(() => {
      expect(onSave).toHaveBeenCalledWith(validConfig);
    });
  });

  it('does not call onSave for invalid JSON', () => {
    const { onSave, onClose } = renderEditor({});
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'not json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    // The invalid editor should still be dismissible via Cancel.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});

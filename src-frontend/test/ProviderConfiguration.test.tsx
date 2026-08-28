/**
 * ProviderConfiguration modal (#554).
 *
 * Exercises add / edit / remove / enable flows and the default-model field
 * without importing App.tsx.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProviderConfiguration from '../components/ProviderConfiguration';
import type { ModelConnection } from '../services/connections';

function baseConn(overrides: Partial<ModelConnection> = {}): ModelConnection {
  return {
    id: 'local-ollama',
    name: 'Local Ollama',
    kind: 'ollama',
    baseUrl: 'http://localhost:11434',
    enabled: true,
    ...overrides,
  };
}

function renderModal(connections: ModelConnection[]) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <ProviderConfiguration
      dark={false}
      connections={connections}
      onSave={onSave}
      onClose={onClose}
    />
  );
  return { onSave, onClose, ...utils };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('ProviderConfiguration (#554)', () => {
  it('renders the list of connections', () => {
    renderModal([baseConn({ name: 'My Provider' })]);
    expect(screen.getByText('My Provider')).toBeTruthy();
  });

  it('add: creates a connection and persists it via onSave', () => {
    const { onSave } = renderModal([]);

    fireEvent.change(screen.getByPlaceholderText('Provider name (e.g., LM Studio)'), {
      target: { value: 'New Provider' },
    });
    fireEvent.change(screen.getByPlaceholderText('Base URL (e.g., http://localhost:1234)'), {
      target: { value: 'http://example.com:1234/' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const added = onSave.mock.calls[0][0];
    expect(added).toHaveLength(1);
    expect(added[0].name).toBe('New Provider');
    expect(added[0].kind).toBe('openai');
    // Trailing slashes are trimmed.
    expect(added[0].baseUrl).toBe('http://example.com:1234');
    expect(added[0].enabled).toBe(true);
  });

  it('add: blocks save until name + base URL are present', () => {
    renderModal([]);
    const addBtn = screen.getByRole('button', { name: 'Add Provider' });
    expect(addBtn).toBeDisabled();
  });

  it('add: stores the declared default model tag', () => {
    const { onSave } = renderModal([]);

    fireEvent.change(screen.getByPlaceholderText('Provider name (e.g., LM Studio)'), {
      target: { value: 'LM Studio' },
    });
    fireEvent.change(screen.getByPlaceholderText('Base URL (e.g., http://localhost:1234)'), {
      target: { value: 'http://localhost:1234' },
    });
    fireEvent.change(screen.getByPlaceholderText('Default model tag (optional)'), {
      target: { value: 'north-mini-code-1.0:q8_0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Provider' }));

    const added = onSave.mock.calls[0][0];
    expect(added[0].defaultModel).toBe('north-mini-code-1.0:q8_0');
  });

  it('edit: reveals edit form after clicking the edit affordance', () => {
    const { onSave } = renderModal([baseConn({ name: 'Existing Provider', kind: 'openai' })]);

    fireEvent.click(screen.getByRole('button', { name: 'Edit provider' }));
    // Save / Cancel buttons appear.
    fireEvent.change(screen.getByPlaceholderText('Provider name (e.g., LM Studio)'), {
      target: { value: 'Renamed Provider' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const updated = onSave.mock.calls[0][0];
    expect(updated[0].name).toBe('Renamed Provider');
  });

  it('edit: cancel discards the temp edit', () => {
    const { onSave, onClose } = renderModal([baseConn({ name: 'Existing Provider' })]);

    fireEvent.click(screen.getByRole('button', { name: 'Edit provider' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSave).not.toHaveBeenCalled();
    // Closing via the X should not fire an unrelated edit save.
    fireEvent.click(screen.getByRole('button', { name: 'Close provider settings' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('toggle: disables / re-enables a connection', () => {
    const { onSave } = renderModal([baseConn()]);
    const toggle = screen.getByRole('button', { name: 'Disable provider' });
    fireEvent.click(toggle);
    expect(onSave).toHaveBeenCalledWith([baseConn({ enabled: false })]);
  });

  it('delete: removes a connection', () => {
    const { onSave } = renderModal([baseConn({ id: 'conn-1' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete provider' }));
    expect(onSave).toHaveBeenCalledWith([]);
  });
});

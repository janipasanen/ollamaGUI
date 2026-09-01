import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionStatusPanel } from '../components/ConnectionStatusPanel';

const mockConnections = [
  { id: 'conn-1', name: 'Local Ollama', kind: 'ollama' as const, baseUrl: 'http://localhost:11434', enabled: true },
  { id: 'conn-2', name: 'LM Studio', kind: 'openai' as const, baseUrl: 'http://localhost:1234', enabled: true },
];

describe('ConnectionStatusPanel', () => {
  it('shows no providers message when no connections', () => {
    render(
      <ConnectionStatusPanel
        connections={[]}
        connectedModels={[]}
        onOpenProviderConfig={vi.fn()}
        dark={false}
      />
    );
    expect(screen.getByText('No providers configured')).toBeDefined();
    expect(screen.getByText('Add a provider →')).toBeDefined();
  });

  it('shows provider names', () => {
    render(
      <ConnectionStatusPanel
        connections={mockConnections}
        connectedModels={[]}
        onOpenProviderConfig={vi.fn()}
        dark={false}
      />
    );
    expect(screen.getByText('Local Ollama')).toBeDefined();
    expect(screen.getByText('LM Studio')).toBeDefined();
  });

  it('shows manage providers button', () => {
    render(
      <ConnectionStatusPanel
        connections={mockConnections}
        connectedModels={[]}
        onOpenProviderConfig={vi.fn()}
        dark={false}
      />
    );
    expect(screen.getByText('Manage providers →')).toBeDefined();
  });

  it('works in dark mode', () => {
    render(
      <ConnectionStatusPanel
        connections={mockConnections}
        connectedModels={[]}
        onOpenProviderConfig={vi.fn()}
        dark={true}
      />
    );
    expect(screen.getByText('Local Ollama')).toBeDefined();
  });
});

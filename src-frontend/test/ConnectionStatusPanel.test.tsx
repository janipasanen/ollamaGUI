/**
 * Provider status panel (#563) — the sidebar replacement for the header's
 * Ollama-only connection dot.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConnectionStatusPanel, { shortEndpoint, type ProviderStatus } from '../components/ConnectionStatusPanel';

const local: ProviderStatus = {
  id: 'local', name: 'Local Ollama', endpoint: 'http://localhost:11434',
  kind: 'ollama', state: 'connected', modelCount: 3,
};
const vllm: ProviderStatus = {
  id: 'v1', name: 'gx10', endpoint: 'http://gx10:8000',
  kind: 'vllm', state: 'disconnected', modelCount: 0,
};

describe('ConnectionStatusPanel (#563)', () => {
  it('lists every provider with its kind and endpoint', () => {
    render(<ConnectionStatusPanel providers={[local, vllm]} onTest={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.getByText('Local Ollama')).toBeInTheDocument();
    expect(screen.getByText('gx10')).toBeInTheDocument();
    expect(screen.getByText('vLLM')).toBeInTheDocument();
    // The scheme is dropped so the row fits the sidebar; the count rides along.
    expect(screen.getByText(/localhost:11434 · 3 models/)).toBeInTheDocument();
    expect(screen.getByText(/^gx10:8000$/)).toBeInTheDocument();
  });

  it('states each provider\'s reachability for assistive tech', () => {
    // The dot is decorative, so the status must be available as text.
    render(<ConnectionStatusPanel providers={[local, vllm]} onTest={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.getByText('Local Ollama: Connected')).toBeInTheDocument();
    expect(screen.getByText('gx10: Not reachable')).toBeInTheDocument();
  });

  it('distinguishes unknown from unreachable', () => {
    // A provider nobody has probed yet must not be reported as broken.
    render(<ConnectionStatusPanel providers={[{ ...vllm, state: 'unknown' }]} onTest={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.getByText('gx10: Unknown')).toBeInTheDocument();
  });

  it('shows a disabled provider as Off regardless of state', () => {
    render(<ConnectionStatusPanel providers={[{ ...vllm, state: 'connected', disabled: true }]} onTest={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.getByText('gx10: Off')).toBeInTheDocument();
  });

  it('tests one provider by id', () => {
    const onTest = vi.fn();
    render(<ConnectionStatusPanel providers={[local, vllm]} onTest={onTest} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Test connection to gx10'));
    expect(onTest).toHaveBeenCalledWith('v1');
  });

  it('disables the Test button while a probe is in flight', () => {
    render(<ConnectionStatusPanel providers={[{ ...vllm, state: 'testing' }]} onTest={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.getByLabelText('Test connection to gx10')).toBeDisabled();
  });

  it('offers Settings when nothing is configured', () => {
    const onOpenSettings = vi.fn();
    render(<ConnectionStatusPanel providers={[]} onTest={vi.fn()} onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByText(/No providers configured/i));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('omits the model count when a provider has none', () => {
    render(<ConnectionStatusPanel providers={[vllm]} onTest={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.queryByText(/0 models/)).not.toBeInTheDocument();
  });

  it('renders a single model without a plural s', () => {
    render(<ConnectionStatusPanel providers={[{ ...vllm, modelCount: 1 }]} onTest={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.getByText(/1 model$/)).toBeInTheDocument();
  });
});

describe('shortEndpoint (#563)', () => {
  it('drops the scheme and any trailing slash', () => {
    expect(shortEndpoint('http://gx10:8000')).toBe('gx10:8000');
    expect(shortEndpoint('https://api.example.com/')).toBe('api.example.com');
    expect(shortEndpoint('http://localhost:11434')).toBe('localhost:11434');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App';

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  window.dispatchEvent(new Event('resize'));
});

afterEach(() => {
  global.fetch = origFetch;
  localStorage.clear();
});

describe('/temp slash command (#291)', () => {
  it('sets the temperature and persists it', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    const composer = screen.getByPlaceholderText('Message Ollama...') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '/temp 0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Temperature set to 0.5')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('ollama_gui_gen_options') ?? '{}').temperature).toBe(0.5);
  });

  it('reports the current temperature with no argument', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/temp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Temperature: default')).toBeInTheDocument();
  });

  it('rejects out-of-range values', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/temp 5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Temperature must be a number between 0 and 2')).toBeInTheDocument();
  });
});

describe('/ctx slash command (#292)', () => {
  it('sets the context window and persists it', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/ctx 8192' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Context window set to 8192')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('ollama_gui_gen_options') ?? '{}').num_ctx).toBe(8192);
  });

  it('reports the current context window with no argument', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/ctx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Context window: 4096')).toBeInTheDocument();
  });

  it('rejects too-small values', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/ctx 100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Context window must be a number >= 512')).toBeInTheDocument();
  });
});


describe('/topp slash command (#294)', () => {
  it('sets top-p and persists it', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/topp 0.9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Top-p set to 0.9')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('ollama_gui_gen_options') ?? '{}').top_p).toBe(0.9);
  });

  it('reports the current top-p with no argument', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/topp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Top-p: default')).toBeInTheDocument();
  });

  it('rejects out-of-range values', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/topp 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Top-p must be a number between 0 and 1')).toBeInTheDocument();
  });
});

describe('/predict slash command (#295)', () => {
  it('sets max tokens and persists it', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/predict 512' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Max tokens set to 512')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('ollama_gui_gen_options') ?? '{}').num_predict).toBe(512);
  });

  it('reports unlimited with no argument', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/predict' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Max tokens: unlimited')).toBeInTheDocument();
  });

  it('rejects invalid values', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/predict 0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Max tokens must be a positive integer (or -1 for unlimited)')).toBeInTheDocument();
  });
});

describe('/stop slash command (#296)', () => {
  it('sets stop sequences and persists them', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/stop <|end|>,STOP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Stop sequences set to 2')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('ollama_gui_gen_options') ?? '{}').stop).toEqual(['<|end|>', 'STOP']);
  });

  it('reports none with no argument', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/stop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Stop sequences: none')).toBeInTheDocument();
  });

  it('clears stop sequences with /stop clear', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    localStorage.setItem('ollama_gui_gen_options', JSON.stringify({ stop: ['END'] }));
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/stop clear' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Stop sequences cleared')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('ollama_gui_gen_options') ?? '{}').stop).toEqual([]);
  });
});


describe('/topk slash command (#298)', () => {
  it('sets top-k and persists it', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/topk 40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Top-k set to 40')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('ollama_gui_gen_options') ?? '{}').top_k).toBe(40);
  });

  it('reports the current top-k with no argument', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/topk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Top-k: default')).toBeInTheDocument();
  });

  it('rejects negative values', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }), body: null, text: async () => '' } as any);
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Message Ollama...'), { target: { value: '/topk -5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Top-k must be a non-negative integer')).toBeInTheDocument();
  });
});

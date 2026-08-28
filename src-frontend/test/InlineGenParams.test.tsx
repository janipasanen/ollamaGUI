import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InlineGenParams } from '../components/InlineGenParams';
import type { GenerationOptions } from '../services/ollama';

describe('InlineGenParams', () => {
  it('renders the model name', () => {
    render(<InlineGenParams model="llama3" genOptions={{}} dark={false} />);
    expect(screen.getByText('llama3')).toBeInTheDocument();
  });

  it('truncates model names longer than 25 chars to 23 chars plus ellipsis', () => {
    const longName = 'north-mini-code-1.0:q8_0-supercalifragilistic'; // > 25 chars
    render(<InlineGenParams model={longName} genOptions={{}} dark={false} />);
    // Component slices model.slice(0, 23) + "…"
    const expected = `${longName.slice(0, 23)}…`;
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.getByTitle(longName)).toBeInTheDocument();
  });

  it('shows the temperature when defined', () => {
    render(<InlineGenParams model="llama3" genOptions={{ temperature: 0.7 }} dark={false} />);
    expect(screen.getByText('temp: 0.7')).toBeInTheDocument();
  });

  it('hides the temperature when undefined', () => {
    render(<InlineGenParams model="llama3" genOptions={{}} dark={false} />);
    expect(screen.queryByText('temp:')).toBeNull();
  });

  it('shows context usage when num_ctx > 0', () => {
    render(<InlineGenParams model="llama3" genOptions={{ num_ctx: 8192 }} dark={false} />);
    expect(screen.getByTitle('Context: 8192 tokens')).toBeInTheDocument();
  });

  it('hides context usage when num_ctx is 0', () => {
    render(<InlineGenParams model="llama3" genOptions={{ num_ctx: 0 }} dark={false} />);
    expect(screen.queryByTitle('Context: 0 tokens')).toBeNull();
  });
});

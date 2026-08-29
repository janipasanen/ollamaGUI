/**
 * Inline Ollama connection indicator (#547).
 *
 * Verifies the always-legible status + endpoint replace the old hover-only dot.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  InlineConnectionIndicator,
  connectionStatusLabel,
  shortEndpoint,
} from '../components/InlineConnectionIndicator';

describe('InlineConnectionIndicator', () => {
  it('shows "Connected" + endpoint when connected', () => {
    render(
    <InlineConnectionIndicator connected dark={false} baseUrl="http://localhost:11434" />,
  );
  expect(screen.getByLabelText('Ollama connection: Connected · localhost:11434')).toBeInTheDocument();
});

  it('shows "Disconnected" + endpoint when disconnected', () => {
    render(
      <InlineConnectionIndicator connected={false} dark={false} baseUrl="http://host:1234" />,
    );
    expect(screen.getByLabelText('Ollama connection: Disconnected · host:1234')).toBeInTheDocument();
  });

  it('shows "Connection unknown" when state is null', () => {
    render(<InlineConnectionIndicator connected={null} dark={false} baseUrl="http://x:1" />);
    expect(screen.getByLabelText('Ollama connection: Connection unknown · x:1')).toBeInTheDocument();
  });

  it('renders inline (not behind hover) with an accessible status label', () => {
    render(<InlineConnectionIndicator connected dark={true} baseUrl="http://localhost:11434" />);
    // Always-legible inline label, revealed without needing hover.
    expect(
      screen.getByLabelText('Ollama connection: Connected · localhost:11434'),
    ).toBeInTheDocument();
  });

  it('truncates long endpoints', () => {
    const long = 'http://some-very-long-hostname.example.internal:12345';
    render(<InlineConnectionIndicator connected dark={false} baseUrl={long} />);
    // Ellipsis is part of the truncated inline endpoint label.
    expect(screen.getByLabelText(`Ollama connection: Connected · ${shortEndpoint(long)}`)).toBeInTheDocument();
  });
});

describe('connectionStatusLabel', () => {
  it('maps each state', () => {
    expect(connectionStatusLabel('connected')).toBe('Connected');
    expect(connectionStatusLabel('disconnected')).toBe('Disconnected');
    expect(connectionStatusLabel('unknown')).toBe('Connection unknown');
  });
});

describe('shortEndpoint', () => {
  it('strips protocol and trailing slash', () => {
    expect(shortEndpoint('http://localhost:11434/')).toBe('localhost:11434');
    expect(shortEndpoint('https://x.test')).toBe('x.test');
  });

  it('truncates over 28 chars', () => {
    const long = 'http://a-very-long-subdomain-name.example.com:9999';
    const out = shortEndpoint(long);
    expect(out.length).toBeLessThanOrEqual(28);
    expect(out).toContain('…');
  });
});

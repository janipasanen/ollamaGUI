import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Sources, { renderWithCitations, InlineCitation } from '../components/Sources';
import type { Source } from '../services/citations';

const sampleSources: Source[] = [
  { id: 's1', label: 'auth.ts', kind: 'file', fileId: 'f1', chunkIndex: 0, title: 'Authentication module' },
  { id: 's2', label: 'example.com', kind: 'url', url: 'https://example.com', title: 'Example Page' },
  { id: 's3', label: 'config.ts', kind: 'chunk', fileId: 'f3', chunkIndex: 2 },
];

describe('Sources component (#120, UI usability)', () => {
  it('renders nothing when sources array is empty', () => {
    const { container } = render(<Sources sources={[]} dark={true} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a collapsible "Sources (N)" summary', () => {
    render(<Sources sources={sampleSources} dark={true} />);
    expect(screen.getByText('Sources (3)')).toBeInTheDocument();
  });

  it('renders each source as a clickable button', () => {
    render(<Sources sources={sampleSources} dark={false} />);
    expect(screen.getByText('auth.ts')).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('config.ts')).toBeInTheDocument();
  });

  it('shows numbered prefixes [1], [2], [3]', () => {
    render(<Sources sources={sampleSources} dark={true} />);
    expect(screen.getByText('[1]')).toBeInTheDocument();
    expect(screen.getByText('[2]')).toBeInTheDocument();
    expect(screen.getByText('[3]')).toBeInTheDocument();
  });

  it('shows source detail (title/url) for sources that have it', () => {
    render(<Sources sources={sampleSources} dark={false} />);
    expect(screen.getByText('Authentication module')).toBeInTheDocument();
    expect(screen.getByText(/Example Page — https:\/\/example.com/)).toBeInTheDocument();
  });
});

describe('InlineCitation (#120)', () => {
  it('renders a clickable superscript with the citation index', () => {
    render(<InlineCitation index={1} source={sampleSources[0]} dark={true} />);
    const btn = screen.getByText('[1]');
    expect(btn.tagName).toBe('BUTTON');
  });

  it('has an accessible aria-label with the source label', () => {
    render(<InlineCitation index={2} source={sampleSources[1]} dark={false} />);
    expect(screen.getByLabelText('Citation 2: example.com')).toBeInTheDocument();
  });
});

describe('renderWithCitations (#120)', () => {
  it('replaces [n] markers with clickable citation elements', () => {
    const text = 'See [1] for details and [2] for the URL.';
    const nodes = renderWithCitations(text, sampleSources, true);
    const { container } = render(<div>{nodes}</div>);
    // Should have 2 citation buttons
    const citeButtons = container.querySelectorAll('sup button');
    expect(citeButtons).toHaveLength(2);
  });

  it('leaves out-of-range markers as literal text', () => {
    const text = 'This [5] is out of range.';
    const nodes = renderWithCitations(text, sampleSources, true);
    const { container } = render(<div>{nodes}</div>);
    // No citation buttons for out-of-range
    const citeButtons = container.querySelectorAll('sup button');
    expect(citeButtons).toHaveLength(0);
    expect(container.textContent).toContain('[5]');
  });

  it('renders plain text without citations unchanged', () => {
    const text = 'No citations here.';
    const nodes = renderWithCitations(text, sampleSources, true);
    const { container } = render(<div>{nodes}</div>);
    expect(container.textContent).toBe('No citations here.');
    expect(container.querySelectorAll('sup button')).toHaveLength(0);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  parseCitationRefs,
  linkifyCitations,
  hasSources,
  openSource,
  _mocks,
  type Source,
} from '../services/citations';
import Sources, { renderWithCitations } from '../components/Sources';

const fileSource: Source = {
  id: 's1',
  label: 'notes.md',
  kind: 'chunk',
  fileId: 'file-1',
  chunkIndex: 2,
  title: 'Intro section',
};
const urlSource: Source = {
  id: 's2',
  label: 'example.com',
  kind: 'url',
  url: 'https://example.com/page',
  title: 'Example Page',
};

afterEach(() => {
  _mocks.open = null;
  vi.restoreAllMocks();
});

describe('parseCitationRefs (#120)', () => {
  it('returns distinct indices, deduped and sorted', () => {
    expect(parseCitationRefs('see [1] and [2] and [1]')).toEqual([1, 2]);
  });

  it('sorts out-of-order references', () => {
    expect(parseCitationRefs('here [3] then [1] then [2]')).toEqual([1, 2, 3]);
  });

  it('ignores [0] and markdown links, returns [] for plain text', () => {
    expect(parseCitationRefs('no markers here')).toEqual([]);
    expect(parseCitationRefs('zero [0] only')).toEqual([]);
    expect(parseCitationRefs('a [1](http://x) link')).toEqual([]);
  });
});

describe('linkifyCitations (#120)', () => {
  it('maps [1] to sources[0] and splits surrounding text', () => {
    const parts = linkifyCitations('A [1] B', [fileSource, urlSource]);
    expect(parts).toEqual([
      { type: 'text', value: 'A ' },
      { type: 'cite', index: 1, source: fileSource },
      { type: 'text', value: ' B' },
    ]);
  });

  it('leaves out-of-range markers as literal text', () => {
    const parts = linkifyCitations('only [5] here', [fileSource]);
    expect(parts).toEqual([{ type: 'text', value: 'only [5] here' }]);
  });
});

describe('hasSources (#120)', () => {
  it('is false for empty / undefined and true for non-empty', () => {
    expect(hasSources()).toBe(false);
    expect(hasSources([])).toBe(false);
    expect(hasSources([fileSource])).toBe(true);
  });
});

describe('<Sources> (#120)', () => {
  it('renders the disclosure and one button per source', () => {
    render(<Sources sources={[fileSource, urlSource]} dark={false} />);
    expect(screen.getByText('Sources (2)')).toBeInTheDocument();
    expect(screen.getByText('notes.md')).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
    // Numbered [n] markers shown for each.
    expect(screen.getByText('[1]')).toBeInTheDocument();
    expect(screen.getByText('[2]')).toBeInTheDocument();
  });

  it('renders nothing when given no sources', () => {
    const { container } = render(<Sources sources={[]} dark={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('clicking a url source opens with the url', async () => {
    const seen: { kind: string; target: string }[] = [];
    _mocks.open = (t) => { seen.push(t); };
    render(<Sources sources={[urlSource]} dark={true} />);
    fireEvent.click(screen.getByText('example.com'));
    await waitFor(() => {
      expect(seen).toEqual([{ kind: 'url', target: 'https://example.com/page' }]);
    });
  });
});

describe('openSource (#120)', () => {
  it('routes url sources to the url target via the mock seam', async () => {
    const seen: { kind: string; target: string }[] = [];
    _mocks.open = (t) => { seen.push(t); };
    await openSource(urlSource);
    expect(seen).toEqual([{ kind: 'url', target: 'https://example.com/page' }]);
  });

  it('routes file sources to the fileId target', async () => {
    const seen: { kind: string; target: string }[] = [];
    _mocks.open = (t) => { seen.push(t); };
    await openSource(fileSource);
    expect(seen).toEqual([{ kind: 'chunk', target: 'file-1' }]);
  });
});

describe('renderWithCitations (#120)', () => {
  it('turns [1] into a clickable element that opens its source', async () => {
    const seen: { kind: string; target: string }[] = [];
    _mocks.open = (t) => { seen.push(t); };
    render(<div>{renderWithCitations('grounded [1] answer', [urlSource], false)}</div>);

    const btn = screen.getByRole('button', { name: /Citation 1/ });
    expect(btn).toBeInTheDocument();
    // Surrounding literal text is preserved.
    expect(screen.getByText(/grounded/)).toBeInTheDocument();

    fireEvent.click(btn);
    await waitFor(() => {
      expect(seen).toEqual([{ kind: 'url', target: 'https://example.com/page' }]);
    });
  });

  it('keeps out-of-range markers as plain text (no button)', () => {
    render(<div>{renderWithCitations('text [9] here', [urlSource], false)}</div>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/text \[9\] here/)).toBeInTheDocument();
  });
});

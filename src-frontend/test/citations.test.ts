import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseCitationRefs,
  linkifyCitations,
  hasSources,
  openSource,
  _mocks,
  type Source,
  type LinkifiedPart,
  type TextPart,
  type CitePart,
} from '../services/citations';

function text(text: string): TextPart {
  return { type: 'text', value: text };
}
function cite(index: number, source: Source): CitePart {
  return { type: 'cite', index, source };
}

const sources: Source[] = [
  { id: 's1', label: 'example.com', kind: 'url', url: 'https://example.com/a', title: 'A' },
  { id: 's2', label: 'readme.md', kind: 'file', fileId: '/repo/readme.md' },
];

beforeEach(() => {
  _mocks.open = null;
});

describe('parseCitationRefs (#120)', () => {
  it('returns distinct 1-based indices, sorted ascending, deduped', () => {
    expect(parseCitationRefs('[3] and [1] then [2] and [1]')).toEqual([1, 2, 3]);
  });

  it('ignores [0] (citations are 1-based)', () => {
    expect(parseCitationRefs('[0] [2]')).toEqual([2]);
  });

  it('skips markdown links [n](url) so they are not mistaken for citations', () => {
    expect(parseCitationRefs('[1](https://x) [2]')).toEqual([2]);
    expect(parseCitationRefs('[3](https://x)')).toEqual([]);
  });

  it('returns an empty array for text with no citations', () => {
    expect(parseCitationRefs('nothing here')).toEqual([]);
    expect(parseCitationRefs('')).toEqual([]);
  });
});

describe('linkifyCitations (#120)', () => {
  it('resolves [n] markers to CiteParts and keeps surrounding text', () => {
    const parts = linkifyCitations('See [1] then [2].', sources);
    expect(parts).toEqual([
      text('See '),
      cite(1, sources[0]),
      text(' then '),
      cite(2, sources[1]),
      text('.'),
    ]);
  });

  it('merges consecutive text parts into one', () => {
    const parts = linkifyCitations('hello world', sources);
    expect(parts).toEqual([text('hello world')]);
  });

  it('leaves literal [n] when the source is out of range', () => {
    const parts = linkifyCitations('ref [5] missing', sources);
    expect(parts).toEqual([text('ref [5] missing')]);
  });

  it('leaves [0] untouched (invalid, 1-based)', () => {
    const parts = linkifyCitations('n [0] here', sources);
    expect(parts).toEqual([text('n [0] here')]);
  });

  it('leaves markdown link markers [n](url) in the text stream', () => {
    const parts = linkifyCitations('link [1](https://x) end', sources);
    expect(parts).toEqual([text('link [1](https://x) end')]);
  });

  it('returns an empty array for empty text', () => {
    expect(linkifyCitations('', sources)).toEqual([]);
  });

  it('uses an empty list of sources as the default', () => {
    const parts = linkifyCitations('plain text', []);
    expect(parts).toEqual([text('plain text')]);
  });
});

describe('hasSources (#120)', () => {
  it('is true when at least one source is present', () => {
    expect(hasSources(sources)).toBe(true);
  });

  it('is false for an empty array or undefined', () => {
    expect(hasSources([])).toBe(false);
    expect(hasSources(undefined)).toBe(false);
  });
});

describe('openSource (#120) via the _mocks test seam', () => {
  it('opens url sources with { kind: "url", target: source.url }', async () => {
    const calls: Array<{ kind: Source['kind']; target: string }> = [];
    _mocks.open = async (target) => { calls.push(target); };
    await openSource({ id: 'u1', label: 'x', kind: 'url', url: 'https://example.com/a' });
    expect(calls).toEqual([{ kind: 'url', target: 'https://example.com/a' }]);
  });

  it('opens file sources with { kind: "file", target: source.fileId }', async () => {
    const calls: Array<{ kind: Source['kind']; target: string }> = [];
    _mocks.open = async (target) => { calls.push(target); };
    await openSource({ id: 'f1', label: 'r', kind: 'file', fileId: '/repo/readme.md' });
    expect(calls).toEqual([{ kind: 'file', target: '/repo/readme.md' }]);
  });

  it('is a no-op for a falsy source', async () => {
    const open = vi.fn();
    _mocks.open = open;
    await openSource(undefined as unknown as Source);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('types', () => {
  it('exposes the LinkifiedPart union as text or cite parts', () => {
    const parts: LinkifiedPart[] = linkifyCitations('[1]', sources);
    for (const part of parts) {
      expect(['text', 'cite']).toContain(part.type);
    }
    expect(parts[0]).toMatchObject({ type: 'cite', index: 1 });
  });
});

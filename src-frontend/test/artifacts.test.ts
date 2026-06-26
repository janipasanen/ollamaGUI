import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectArtifacts, pickPrimaryArtifact, exportArtifact,
  type Artifact,
} from '../services/artifacts';

// ── detectArtifacts ───────────────────────────────────────────────────────────

describe('detectArtifacts', () => {
  it('returns empty array for plain text with no code blocks', () => {
    expect(detectArtifacts('Hello world, no code here.')).toEqual([]);
  });

  it('ignores short snippets below threshold', () => {
    const msg = '```js\nconsole.log("hi");\n```';
    expect(detectArtifacts(msg)).toHaveLength(0);
  });

  it('detects a large code block above the line threshold', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const msg = `\`\`\`javascript\n${lines}\n\`\`\``;
    const arts = detectArtifacts(msg);
    expect(arts).toHaveLength(1);
    expect(arts[0].language).toBe('javascript');
    expect(arts[0].kind).toBe('code');
  });

  it('classifies html language as html kind', () => {
    const code = Array(8).fill('<div>hello</div>').join('\n');
    const msg = `\`\`\`html\n${code}\n\`\`\``;
    const arts = detectArtifacts(msg);
    expect(arts[0].kind).toBe('html');
  });

  it('classifies svg as svg kind', () => {
    const code = Array(8).fill('<rect x="0" y="0" width="10" height="10"/>').join('\n');
    const msg = `\`\`\`svg\n${code}\n\`\`\``;
    const arts = detectArtifacts(msg);
    expect(arts[0].kind).toBe('svg');
  });

  it('classifies markdown as markdown kind', () => {
    const code = Array(8).fill('# Heading\n\nParagraph text.').join('\n');
    const msg = `\`\`\`markdown\n${code}\n\`\`\``;
    const arts = detectArtifacts(msg);
    expect(arts[0].kind).toBe('markdown');
  });

  it('detects multiple large blocks in one message', () => {
    const block = Array(8).fill('const x = 1;').join('\n');
    const msg = `\`\`\`js\n${block}\n\`\`\`\n\nsome text\n\n\`\`\`py\n${block}\n\`\`\``;
    expect(detectArtifacts(msg)).toHaveLength(2);
  });

  it('uses char threshold for long single-line content', () => {
    const longLine = 'x'.repeat(350);
    const msg = `\`\`\`json\n${longLine}\n\`\`\``;
    expect(detectArtifacts(msg)).toHaveLength(1);
  });

  it('returns artifacts with id and createdAt', () => {
    const code = Array(10).fill('const a = 1;').join('\n');
    const [art] = detectArtifacts(`\`\`\`ts\n${code}\n\`\`\``);
    expect(art.id).toBeTruthy();
    expect(art.createdAt).toBeGreaterThan(0);
  });

  it('handles code block with no language tag', () => {
    const code = Array(8).fill('some line').join('\n');
    const msg = `\`\`\`\n${code}\n\`\`\``;
    const arts = detectArtifacts(msg);
    expect(arts).toHaveLength(1);
    expect(arts[0].language).toBe('text');
  });
});

// ── pickPrimaryArtifact ───────────────────────────────────────────────────────

describe('pickPrimaryArtifact', () => {
  it('returns null for empty list', () => {
    expect(pickPrimaryArtifact([])).toBeNull();
  });

  it('prefers html kind over code kind', () => {
    const html: Artifact = { id: '1', kind: 'html', language: 'html', code: 'a', title: 'html', createdAt: 1 };
    const code: Artifact = { id: '2', kind: 'code', language: 'js', code: 'b'.repeat(100), title: 'js', createdAt: 2 };
    expect(pickPrimaryArtifact([code, html])?.kind).toBe('html');
  });

  it('prefers svg kind over code kind', () => {
    const svg: Artifact = { id: '1', kind: 'svg', language: 'svg', code: '<svg/>', title: 'svg', createdAt: 1 };
    const code: Artifact = { id: '2', kind: 'code', language: 'ts', code: 'x'.repeat(100), title: 'ts', createdAt: 2 };
    expect(pickPrimaryArtifact([code, svg])?.kind).toBe('svg');
  });

  it('returns the longest code block when no html/svg', () => {
    const a: Artifact = { id: '1', kind: 'code', language: 'js', code: 'a'.repeat(50), title: 'j', createdAt: 1 };
    const b: Artifact = { id: '2', kind: 'code', language: 'py', code: 'b'.repeat(200), title: 'p', createdAt: 2 };
    expect(pickPrimaryArtifact([a, b])?.id).toBe('2');
  });
});

// ── exportArtifact ────────────────────────────────────────────────────────────

describe('exportArtifact', () => {
  let clickSpy: ReturnType<typeof vi.fn>;
  let revokeUrlSpy: ReturnType<typeof vi.fn>;
  let createElement_: typeof document.createElement;

  beforeEach(() => {
    clickSpy = vi.fn();
    revokeUrlSpy = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeUrlSpy);
    createElement_ = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = createElement_(tag);
      if (tag === 'a') (el as HTMLAnchorElement).click = clickSpy;
      return el;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('triggers a download click', () => {
    const art: Artifact = { id: '1', kind: 'html', language: 'html', code: '<h1>hi</h1>', title: 'html', createdAt: 1 };
    exportArtifact(art);
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it('uses .html extension for html kind', () => {
    const art: Artifact = { id: '1', kind: 'html', language: 'html', code: '<div/>', title: 't', createdAt: 1 };
    let capturedEl: HTMLAnchorElement | null = null;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = createElement_(tag);
      if (tag === 'a') { (el as any).click = clickSpy; capturedEl = el as HTMLAnchorElement; }
      return el;
    });
    exportArtifact(art);
    expect((capturedEl as any)?.download).toBe('artifact.html');
  });

  it('uses .svg extension for svg kind', () => {
    const art: Artifact = { id: '1', kind: 'svg', language: 'svg', code: '<svg/>', title: 't', createdAt: 1 };
    let capturedEl: HTMLAnchorElement | null = null;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = createElement_(tag);
      if (tag === 'a') { (el as any).click = clickSpy; capturedEl = el as HTMLAnchorElement; }
      return el;
    });
    exportArtifact(art);
    expect((capturedEl as any)?.download).toBe('artifact.svg');
  });

  it('uses .js extension for javascript code', () => {
    const art: Artifact = { id: '1', kind: 'code', language: 'javascript', code: 'x', title: 'js', createdAt: 1 };
    let capturedEl: HTMLAnchorElement | null = null;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = createElement_(tag);
      if (tag === 'a') { (el as any).click = clickSpy; capturedEl = el as HTMLAnchorElement; }
      return el;
    });
    exportArtifact(art);
    expect((capturedEl as any)?.download).toBe('artifact.js');
  });
});

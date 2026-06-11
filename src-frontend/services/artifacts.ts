/**
 * Artifact detection (#99).
 *
 * An "artifact" is a substantial fenced code block extracted from an assistant
 * message. Self-contained HTML/SVG artifacts get a live iframe preview.
 * The threshold is 6 lines or 300 chars — small inline snippets stay in chat.
 */

export type ArtifactKind = 'html' | 'svg' | 'code' | 'markdown';

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  language: string;
  code: string;
  /** Display title derived from the language tag or filename comment */
  title: string;
  createdAt: number;
}

const THRESHOLD_LINES = 6;
const THRESHOLD_CHARS = 300;

const FENCED_RE = /```([^\n`]*)\n([\s\S]*?)```/g;

function classifyLanguage(lang: string): ArtifactKind {
  const l = lang.trim().toLowerCase();
  if (l === 'html') return 'html';
  if (l === 'svg') return 'svg';
  if (l === 'markdown' || l === 'md') return 'markdown';
  return 'code';
}

function isWorthyArtifact(code: string): boolean {
  const lines = code.split('\n').length;
  return lines >= THRESHOLD_LINES || code.length >= THRESHOLD_CHARS;
}

/** Extract artifact-worthy code blocks from an assistant message. */
export function detectArtifacts(content: string): Artifact[] {
  const artifacts: Artifact[] = [];
  FENCED_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCED_RE.exec(content)) !== null) {
    const lang = (match[1] ?? '').trim() || 'text';
    const code = match[2] ?? '';
    if (!isWorthyArtifact(code)) continue;
    artifacts.push({
      id: `art-${artifacts.length}-${Date.now()}`,
      kind: classifyLanguage(lang),
      language: lang,
      code,
      title: lang || 'snippet',
      createdAt: Date.now(),
    });
  }
  return artifacts;
}

/** Return the single best artifact from a list (prefer HTML/SVG, then longest). */
export function pickPrimaryArtifact(artifacts: Artifact[]): Artifact | null {
  if (artifacts.length === 0) return null;
  const html = artifacts.find(a => a.kind === 'html' || a.kind === 'svg');
  if (html) return html;
  return artifacts.reduce((best, a) => a.code.length > best.code.length ? a : best);
}

/** Download an artifact as a file in the browser. */
export function exportArtifact(artifact: Artifact): void {
  const ext = artifact.kind === 'html' ? 'html'
    : artifact.kind === 'svg' ? 'svg'
    : artifact.kind === 'markdown' ? 'md'
    : extensionForLanguage(artifact.language);
  const blob = new Blob([artifact.code], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `artifact.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

function extensionForLanguage(lang: string): string {
  const map: Record<string, string> = {
    javascript: 'js', typescript: 'ts', python: 'py', rust: 'rs',
    go: 'go', java: 'java', cpp: 'cpp', c: 'c', css: 'css',
    json: 'json', yaml: 'yml', toml: 'toml', shell: 'sh', bash: 'sh',
  };
  return map[lang.toLowerCase()] ?? 'txt';
}

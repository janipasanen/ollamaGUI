/**
 * Goal mode with a judge model (#668) — the judge service.
 *
 * The judge is advisory: every failure path must resolve to `continue` so a
 * broken judge can never break a run.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildJudgeTranscript,
  formatJudgeVerdict,
  goalSystemMessage,
  parseJudgeVerdict,
  runJudge,
  JUDGE_TRANSCRIPT_MAX_CHARS,
} from '../services/judge';
import type { Message } from '../services/ollama';

const msg = (role: string, content: string, name?: string): Message =>
  ({ role, content, ...(name ? { name } : {}) }) as Message;

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('parseJudgeVerdict', () => {
  it('parses a plain JSON verdict', () => {
    expect(parseJudgeVerdict('{"verdict":"done","reason":"tests pass"}')).toEqual({
      verdict: 'done', reason: 'tests pass',
    });
  });

  it('parses a fenced JSON verdict with prose around it', () => {
    const text = 'Here is my answer:\n```json\n{"verdict": "blocked", "reason": "missing dep", "advice": "npm install"}\n```';
    expect(parseJudgeVerdict(text)).toEqual({
      verdict: 'blocked', reason: 'missing dep', advice: 'npm install',
    });
  });

  it('accepts synonyms and alternate keys', () => {
    expect(parseJudgeVerdict('{"status":"completed","reason":"ok"}').verdict).toBe('done');
    expect(parseJudgeVerdict('{"result":"stuck","reason":"same error twice"}').verdict).toBe('blocked');
  });

  it('accepts a bare leading word from a small model', () => {
    expect(parseJudgeVerdict('DONE — the failing test now passes').verdict).toBe('done');
    expect(parseJudgeVerdict('blocked: no network').verdict).toBe('blocked');
  });

  it('defaults to continue on unusable output', () => {
    expect(parseJudgeVerdict('').verdict).toBe('continue');
    expect(parseJudgeVerdict('I am not sure what you want').verdict).toBe('continue');
    expect(parseJudgeVerdict('{"verdict":"maybe"}').verdict).toBe('continue');
  });

  it('never returns advice for a non-blocked verdict', () => {
    expect(parseJudgeVerdict('{"verdict":"done","reason":"x","advice":"do more"}').advice).toBeUndefined();
  });
});

describe('goalSystemMessage', () => {
  it('states the goal and both exit conditions', () => {
    const m = goalSystemMessage('  make the suite green  ');
    expect(m.role).toBe('system');
    expect(m.content).toContain('make the suite green');
    expect(m.content).toContain('achieved');
    expect(m.content).toContain('blocked');
  });
});

describe('buildJudgeTranscript', () => {
  it('labels non-system messages and skips system ones', () => {
    const t = buildJudgeTranscript([
      msg('system', 'you are a bot'),
      msg('user', 'do the thing'),
      msg('tool', 'result text', 'read_file'),
    ]);
    expect(t).not.toContain('you are a bot');
    expect(t).toContain('USER: do the thing');
    expect(t).toContain('TOOL (read_file): result text');
  });

  it('keeps the tail and marks the cut when over budget', () => {
    const messages = [msg('user', 'A'.repeat(500)), msg('assistant', 'TAIL-MARKER')];
    const t = buildJudgeTranscript(messages, 120);
    expect(t.length).toBeLessThanOrEqual(120 + 40);
    expect(t).toContain('truncated');
    expect(t).toContain('TAIL-MARKER');
  });

  it('uses the documented default budget', () => {
    const long = [msg('user', 'B'.repeat(JUDGE_TRANSCRIPT_MAX_CHARS + 500))];
    expect(buildJudgeTranscript(long)).toContain('truncated');
    expect(buildJudgeTranscript(long).length).toBeLessThanOrEqual(JUDGE_TRANSCRIPT_MAX_CHARS + 40);
  });
});

describe('runJudge', () => {
  it('sends a non-streaming, JSON-constrained request with goal and transcript', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: { content: '{"verdict":"done","reason":"ok"}' } }));
    const verdict = await runJudge({
      endpoint: 'http://x/api/chat', model: 'judge:1b', goal: 'ship it',
      messages: [msg('user', 'work')], fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe('http://x/api/chat');
    expect(body.model).toBe('judge:1b');
    expect(body.stream).toBe(false);
    expect(body.format).toBe('json');
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].content).toContain('ship it');
    expect(body.messages[1].content).toContain('USER: work');
    expect(verdict).toMatchObject({ verdict: 'done', reason: 'ok', model: 'judge:1b' });
  });

  it('reads OpenAI-shaped responses too', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '{"verdict":"blocked","reason":"x","advice":"y"}' } }] }));
    const verdict = await runJudge({
      endpoint: 'http://x/api/chat', model: 'j', goal: 'g', messages: [msg('user', 'u')],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict).toMatchObject({ verdict: 'blocked', advice: 'y' });
  });

  it('resolves to continue on an HTTP error instead of throwing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'model not found' }, false));
    const verdict = await runJudge({
      endpoint: 'http://x/api/chat', model: 'j', goal: 'g', messages: [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict.verdict).toBe('continue');
    expect(verdict.reason).toContain('model not found');
  });

  it('resolves to continue when the fetch rejects (judge down)', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const verdict = await runJudge({
      endpoint: 'http://x/api/chat', model: 'j', goal: 'g', messages: [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict.verdict).toBe('continue');
    expect(verdict.reason).toContain('judge unavailable');
  });

  it('reports a timeout as continue rather than hanging the run', async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error('timed out');
      err.name = 'TimeoutError';
      throw err;
    });
    const verdict = await runJudge({
      endpoint: 'http://x/api/chat', model: 'j', goal: 'g', messages: [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict).toMatchObject({ verdict: 'continue', reason: 'judge timed out' });
  });
});

describe('formatJudgeVerdict', () => {
  it('names the judge, the verdict and the advice', () => {
    const line = formatJudgeVerdict({ verdict: 'blocked', reason: 'missing dep', advice: 'npm ci', model: 'j' });
    expect(line).toContain('Judge (j)');
    expect(line).toContain('blocked');
    expect(line).toContain('npm ci');
  });
});

/**
 * Goal mode in the agent loop (#668).
 *
 * What is being pinned here is the *control flow*: the judge is consulted where
 * a run would otherwise end, its advice re-enters the context, its budget is
 * enforced, and a run without a judge behaves exactly as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { agenticChatStream } from '../services/agent';
import { toolRegistry } from '../services/tools';
import type { JudgeVerdict } from '../services/judge';

function streamResponse(lines: string[]) {
  const text = lines.join('\n') + '\n';
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: async () => {
            if (!sent) { sent = true; return { done: false, value: new TextEncoder().encode(text) }; }
            return { done: true, value: undefined };
          },
        };
      },
    },
  };
}

const finalLine = (content: string) => JSON.stringify({ message: { role: 'assistant', content }, done: true });

beforeEach(() => {
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
});
afterEach(() => {
  toolRegistry.getAllTools().forEach(t => toolRegistry.unregisterTool(t.name));
  vi.restoreAllMocks();
});

describe('goal mode with a judge (#668)', () => {
  it('stops without a judge call when only a goal is set', async () => {
    global.fetch = vi.fn(async () => streamResponse([finalLine('done')])) as never;
    const runJudgeFn = vi.fn();
    const out: string[] = [];
    for await (const m of agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 2,
      endpoint: 'http://x/api/chat', goal: 'ship it', runJudgeFn,
    })) out.push(m.content);

    expect(runJudgeFn).not.toHaveBeenCalled();
    expect(out.join('\n')).not.toContain('Judge');
  });

  it('injects the goal into the system context', async () => {
    const fetchMock = vi.fn(async () => streamResponse([finalLine('ok')]));
    global.fetch = fetchMock as never;
    for await (const _ of agenticChatStream({
      model: 'm', messages: [{ role: 'system', content: 'base' }, { role: 'user', content: 'go' }],
      maxIterations: 1, endpoint: 'http://x/api/chat', goal: 'make tests green',
    })) { /* drain */ }

    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    const roles = body.messages.map((m: { role: string }) => m.role);
    expect(roles[0]).toBe('system');
    expect(roles[1]).toBe('system'); // goal sits right after the base system prompt
    expect(body.messages[1].content).toContain('make tests green');
    expect(body.messages[2].role).toBe('user');
  });

  it('a blocked verdict with advice continues the run with the advice in context', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(streamResponse([finalLine('I am stuck.')]))
      .mockResolvedValueOnce(streamResponse([finalLine('Fixed it.')]));
    global.fetch = fetchMock as never;
    const runJudgeFn = vi.fn(async (): Promise<JudgeVerdict> => ({
      verdict: 'blocked', reason: 'dependency missing', advice: 'run npm ci then retry', model: 'j',
    }));

    const out: string[] = [];
    const verdicts: JudgeVerdict[] = [];
    for await (const m of agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 1,
      endpoint: 'http://x/api/chat', goal: 'fix the test', judgeModel: 'j',
      // One judge call: after the granted extension the budget is spent, so
      // the second final answer ends the run without another verdict.
      maxJudgeCalls: 1,
      runJudgeFn, onJudgeVerdict: v => verdicts.push(v),
    })) out.push(m.content);

    // The run went round a second time, which means the iteration cap was extended.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runJudgeFn).toHaveBeenCalledTimes(1);
    expect(verdicts).toHaveLength(1);
    expect(out.some(c => c.includes('Judge') && c.includes('blocked'))).toBe(true);

    // The advice is what the model sees on the retry.
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    const lastSystem = [...secondBody.messages].reverse().find((m: { role: string }) => m.role === 'system');
    expect(lastSystem.content).toContain('run npm ci then retry');
  });

  it('a done verdict ends the run and is surfaced', async () => {
    const fetchMock = vi.fn(async () => streamResponse([finalLine('All done.')]));
    global.fetch = fetchMock as never;
    const runJudgeFn = vi.fn(async (): Promise<JudgeVerdict> => ({
      verdict: 'done', reason: 'the suite is green', model: 'j',
    }));

    const out: string[] = [];
    for await (const m of agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 3,
      endpoint: 'http://x/api/chat', goal: 'green suite', judgeModel: 'j', runJudgeFn,
    })) out.push(m.content);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runJudgeFn).toHaveBeenCalledTimes(1);
    const verdictLine = out.find(c => c.includes('Judge'));
    expect(verdictLine).toContain('done');
    expect(verdictLine).toContain('the suite is green');
  });

  it('a continue verdict leaves the normal ending untouched', async () => {
    global.fetch = vi.fn(async () => streamResponse([finalLine('Progress made.')])) as never;
    const runJudgeFn = vi.fn(async (): Promise<JudgeVerdict> => ({ verdict: 'continue', reason: 'still going', model: 'j' }));

    const out: string[] = [];
    for await (const m of agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 3,
      endpoint: 'http://x/api/chat', goal: 'g', judgeModel: 'j', runJudgeFn,
    })) out.push(m.content);

    expect(out.some(c => c.includes('still going'))).toBe(true);
    expect(out.some(c => c.includes('maximum tool iterations'))).toBe(false);
  });

  it('respects maxJudgeCalls so a chatty judge cannot loop the run forever', async () => {
    const fetchMock = vi.fn(async () => streamResponse([finalLine('stuck')]));
    global.fetch = fetchMock as never;
    const runJudgeFn = vi.fn(async (): Promise<JudgeVerdict> => ({
      verdict: 'blocked', reason: 'same error', advice: 'try again', model: 'j',
    }));

    for await (const _ of agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 1,
      endpoint: 'http://x/api/chat', goal: 'g', judgeModel: 'j',
      runJudgeFn, maxJudgeCalls: 2,
    })) { /* drain */ }

    expect(runJudgeFn).toHaveBeenCalledTimes(2);
    // 1 initial turn + 2 judge-granted extensions, each of JUDGE_EXTRA_ITERATIONS.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(1 + 2 * 3 + 2);
  });

  it('a blocked verdict without advice ends the run (nothing to act on)', async () => {
    const fetchMock = vi.fn(async () => streamResponse([finalLine('stuck')]));
    global.fetch = fetchMock as never;
    const runJudgeFn = vi.fn(async (): Promise<JudgeVerdict> => ({
      verdict: 'blocked', reason: 'out of ideas', model: 'j',
    }));

    const out: string[] = [];
    for await (const m of agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 2,
      endpoint: 'http://x/api/chat', goal: 'g', judgeModel: 'j', runJudgeFn,
    })) out.push(m.content);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runJudgeFn).toHaveBeenCalledTimes(1);
    expect(out.some(c => c.includes('out of ideas'))).toBe(true);
  });

  it('does not judge a cancelled run', async () => {
    const controller = new AbortController();
    global.fetch = vi.fn(async () => {
      controller.abort();
      const err = new Error('aborted'); err.name = 'AbortError'; throw err;
    }) as never;
    const runJudgeFn = vi.fn();

    for await (const _ of agenticChatStream({
      model: 'm', messages: [{ role: 'user', content: 'go' }], maxIterations: 2,
      endpoint: 'http://x/api/chat', goal: 'g', judgeModel: 'j',
      signal: controller.signal, runJudgeFn,
    })) { /* drain */ }

    expect(runJudgeFn).not.toHaveBeenCalled();
  });
});

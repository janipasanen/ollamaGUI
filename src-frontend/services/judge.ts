/**
 * Goal mode with a judge model (#668).
 *
 * An agentic run ends when the main model stops calling tools or runs out of
 * iterations. Neither says anything about whether the *goal* was met, and a
 * model that is stuck ("cannot proceed: the file does not exist") simply stops.
 *
 * A judge is a second, usually cheaper model asked one question: given this
 * goal and this transcript, is the work done, is it blocked, or should the run
 * carry on? A `blocked` verdict may carry advice that is fed back to the main
 * model, so a blocked run can recover instead of dying.
 *
 * The judge is advisory by construction: every failure (bad JSON, timeout,
 * missing model) resolves to `continue`, which leaves the run's normal ending
 * untouched. A judge must never be the reason a run fails.
 */

import { ollamaErrorFromResponse, type Message } from './ollama';
import { PROVIDER_TIMEOUTS, timeoutSignal } from './net';

export type JudgeVerdictKind = 'done' | 'blocked' | 'continue';

export interface JudgeVerdict {
  verdict: JudgeVerdictKind;
  reason: string;
  /** Concrete suggestion for the blocked case; fed back to the main model. */
  advice?: string;
  /** Judge model that produced the verdict, for the transcript label. */
  model?: string;
}

/** Judge calls allowed per run before the run is allowed to end as-is. */
export const JUDGE_MAX_CALLS = 3;

/** How much transcript the judge sees. Its context is usually far smaller. */
export const JUDGE_TRANSCRIPT_MAX_CHARS = 6000;

/** Extra iterations granted per blocked verdict (#668). */
export const JUDGE_EXTRA_ITERATIONS = 3;

/** System message that gives the main model its goal. */
export function goalSystemMessage(goal: string): Message {
  return {
    role: 'system',
    content:
      `GOAL (the user's success criterion for this run):\n${goal.trim()}\n\n` +
      'Work towards that goal. When you believe it is achieved, say so explicitly ' +
      'and summarise what you changed. If you are blocked, say exactly what blocks ' +
      'you and what you tried, instead of stopping silently.',
  };
}

/**
 * Render the conversation for the judge: the tail, role-labelled, capped.
 * The tail matters because the last turns carry the state; a head-truncated
 * transcript would show the plan and hide the outcome.
 */
export function buildJudgeTranscript(
  messages: Message[],
  maxChars: number = JUDGE_TRANSCRIPT_MAX_CHARS,
): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue; // the judge gets the goal separately
    const content = (m.content ?? '').trim();
    if (!content) continue;
    lines.push(`${m.role.toUpperCase()}${m.name ? ` (${m.name})` : ''}: ${content}`);
  }
  const joined = lines.join('\n\n');
  if (joined.length <= maxChars) return joined;
  // Keep the tail and mark the cut so the judge knows it is seeing a fragment.
  return `[…earlier transcript truncated…]\n\n${joined.slice(joined.length - maxChars)}`;
}

/** Strip ```json fences and any prose around the JSON object. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first !== -1 && last > first) return body.slice(first, last + 1);
  return body.trim();
}

const SYNONYMS: Record<string, JudgeVerdictKind> = {
  done: 'done',
  complete: 'done',
  completed: 'done',
  finished: 'done',
  success: 'done',
  blocked: 'blocked',
  block: 'blocked',
  stuck: 'blocked',
  impossible: 'blocked',
  continue: 'continue',
  ongoing: 'continue',
  progress: 'continue',
  'in progress': 'continue',
};

function normaliseKind(raw: unknown): JudgeVerdictKind | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  return SYNONYMS[key] ?? null;
}

/**
 * Parse the judge's answer. Accepts a JSON object, a fenced JSON block, or a
 * bare first word; anything unrecognised means "continue" — the safe default
 * that neither stops a working run nor restarts a finished one.
 */
export function parseJudgeVerdict(text: string): JudgeVerdict {
  const raw = (text ?? '').trim();
  if (!raw) return { verdict: 'continue', reason: 'judge returned nothing' };

  try {
    const obj = JSON.parse(extractJson(raw)) as Record<string, unknown>;
    const kind = normaliseKind(obj.verdict ?? obj.status ?? obj.result);
    if (kind) {
      const reason = typeof obj.reason === 'string' ? obj.reason.trim() : '';
      const advice = typeof obj.advice === 'string' ? obj.advice.trim() : '';
      return {
        verdict: kind,
        reason: reason || 'judge gave no reason',
        // Advice only means something when the run is blocked; dropping it
        // elsewhere keeps the transcript from advertising a step nobody takes.
        ...(kind === 'blocked' && advice ? { advice } : {}),
      };
    }
  } catch {
    // Not JSON — fall through to the word scan below.
  }

  // Bare-word answers are common from small models: "DONE — the tests pass".
  const head = raw.replace(/^[^A-Za-z]+/, '').split(/[\s,:.;!\-]+/)[0];
  const kind = normaliseKind(head);
  if (kind) {
    return { verdict: kind, reason: raw.slice(0, 400) };
  }
  return { verdict: 'continue', reason: raw.slice(0, 400) };
}

export interface RunJudgeOptions {
  /** Full /api/chat URL. */
  endpoint: string;
  model: string;
  goal: string;
  messages: Message[];
  signal?: AbortSignal;
  maxChars?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

/** Combine the caller's abort signal with the judge timeout. */
function anySignal(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const live = signals.filter((s): s is AbortSignal => !!s);
  if (live.length === 0) return undefined;
  if (live.length === 1) return live[0];
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') return anyFn(live);
  const controller = new AbortController();
  for (const s of live) {
    if (s.aborted) { controller.abort(); break; }
    s.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

function judgePrompt(goal: string, transcript: string): Message[] {
  return [
    {
      role: 'system',
      content:
        'You are a judge reviewing an AI coding agent\'s work against a goal. ' +
        'Answer with JSON only: {"verdict": "done" | "blocked" | "continue", ' +
        '"reason": "one sentence citing evidence from the transcript", ' +
        '"advice": "only when blocked: a concrete next step the agent has not tried"}. ' +
        'Choose "done" only if the transcript shows the goal achieved. Choose ' +
        '"blocked" only if the agent stopped or is repeating itself without ' +
        'progress. Choose "continue" if work is still progressing normally.',
    },
    {
      role: 'user',
      content: `GOAL:\n${goal.trim()}\n\nTRANSCRIPT:\n${transcript}`,
    },
  ];
}

/** Pull the assistant text out of an Ollama or OpenAI-shaped response. */
function responseText(body: any): string {
  const ollama = body?.message?.content;
  if (typeof ollama === 'string') return ollama;
  const openai = body?.choices?.[0]?.message?.content;
  return typeof openai === 'string' ? openai : '';
}

/**
 * Ask the judge. Never throws: a judge that cannot answer is not allowed to
 * break the run, so failures come back as `continue` with the reason attached.
 */
export async function runJudge(options: RunJudgeOptions): Promise<JudgeVerdict> {
  const { endpoint, model, goal, messages, signal, maxChars, fetchImpl } = options;
  const judgeModel = model;
  const transcript = buildJudgeTranscript(messages, maxChars);

  try {
    const resp = await (fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: judgeModel,
        messages: judgePrompt(goal, transcript),
        stream: false,
        format: 'json',
        options: { temperature: 0 },
      }),
      signal: anySignal([signal, timeoutSignal(PROVIDER_TIMEOUTS.judge)]),
    });

    if (!resp.ok) {
      const err = await ollamaErrorFromResponse(resp, 'Judge model error');
      return { verdict: 'continue', reason: err.message, model: judgeModel };
    }

    const body = await resp.json();
    const parsed = parseJudgeVerdict(responseText(body));
    return { ...parsed, model: judgeModel };
  } catch (error) {
    const name = (error as { name?: string })?.name ?? '';
    const reason = name === 'TimeoutError' || name === 'AbortError'
      ? 'judge timed out'
      : `judge unavailable: ${error instanceof Error ? error.message : String(error)}`;
    return { verdict: 'continue', reason, model: judgeModel };
  }
}

/** One-line label for the transcript. */
export function formatJudgeVerdict(v: JudgeVerdict): string {
  const who = v.model ? ` (${v.model})` : '';
  const advice = v.advice ? `\nAdvice for the agent: ${v.advice}` : '';
  return `⚖️ Judge${who}: **${v.verdict}** — ${v.reason}${advice}`;
}

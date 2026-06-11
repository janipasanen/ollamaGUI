// Cloud-brain / local-worker multi-agent orchestration.
//
// When MLX "cloud brain / local worker" mode is enabled, a capable cloud model
// acts as the BRAIN (plans and decomposes the task, then reviews/synthesizes),
// while a local model (MLX-accelerated or Ollama) acts as the WORKER (executes
// the delegated instruction). This trades a little latency for higher-quality
// planning while keeping the bulk of token generation on the local machine.

import { Message, fetchOllamaChatStream } from './ollama';
import { fetchMlxChatStream } from './mlx';

export type OrchestratorPhase = 'brain-plan' | 'worker' | 'brain-final';

export interface OrchestratorOptions {
  /** Cloud model used as the planner/orchestrator. */
  brainModel: string;
  /** Local model (MLX or Ollama) used as the executor. */
  workerModel: string;
  /** Full chat history including the system message and latest user turn. */
  messages: Message[];
  /** Ollama base chat endpoint, e.g. http://localhost:11434/api/chat */
  ollamaEndpoint: string;
  /** Cloud chat endpoint, e.g. https://cloud.ollama.ai/api/chat */
  cloudEndpoint: string;
  /** When set + active, the worker runs on the local MLX server. */
  mlx?: { active: boolean; port: number };
  /** Called when a new phase begins (for UI labeling). */
  onPhase: (phase: OrchestratorPhase, label: string) => void;
  /** Called with incremental text for the current phase. */
  onDelta: (phase: OrchestratorPhase, fullText: string) => void;
  signal?: AbortSignal;
}

/** Route a single streaming completion to the right backend for `model`. */
async function streamChat(
  model: string,
  messages: Message[],
  isCloud: boolean,
  opts: OrchestratorOptions,
  onText: (full: string) => void,
): Promise<string> {
  let acc = '';

  if (!isCloud && opts.mlx?.active && model === opts.workerModel) {
    // Worker on MLX server.
    await fetchMlxChatStream(
      model,
      messages,
      (delta) => { acc += delta; onText(acc); },
      opts.mlx.port,
      { signal: opts.signal },
    );
    return acc;
  }

  const endpoint = isCloud ? opts.cloudEndpoint : opts.ollamaEndpoint;
  await fetchOllamaChatStream(
    model,
    messages,
    (chunk) => {
      if (chunk.message?.content) { acc += chunk.message.content; onText(acc); }
    },
    endpoint,
  );
  return acc;
}

function lastUserContent(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
}

/**
 * Run the brain→worker→brain pipeline. Streams each phase via callbacks.
 * Returns the final synthesized answer.
 */
export async function runCloudBrainLocalWorker(opts: OrchestratorOptions): Promise<string> {
  const task = lastUserContent(opts.messages);

  // ── Phase 1: Brain plans and writes a precise instruction for the worker ──
  opts.onPhase('brain-plan', '🧠 Brain — planning');
  const planMessages: Message[] = [
    {
      role: 'system',
      content:
        'You are the BRAIN in a two-model team. A smaller local WORKER model will execute your instructions. ' +
        'Analyze the user task, then output a brief plan followed by a single clear, self-contained INSTRUCTION ' +
        'for the worker to carry out. Keep the instruction concrete and unambiguous. ' +
        'Format:\nPLAN: <2-4 short bullet steps>\nINSTRUCTION: <one paragraph the worker can execute directly>',
    },
    ...opts.messages.filter(m => m.role !== 'system'),
  ];
  const planText = await streamChat(opts.brainModel, planMessages, true, opts,
    (full) => opts.onDelta('brain-plan', full));

  // Extract the worker instruction (fallback to the whole plan / original task).
  const instrMatch = planText.match(/INSTRUCTION:\s*([\s\S]+)/i);
  const workerInstruction = (instrMatch?.[1] || planText || task).trim();

  // ── Phase 2: Worker executes the brain's instruction ──
  opts.onPhase('worker', '🛠 Worker — executing');
  const workerMessages: Message[] = [
    { role: 'system', content: 'You are the WORKER. Execute the instruction precisely and return the result.' },
    { role: 'user', content: workerInstruction },
  ];
  const workerOutput = await streamChat(opts.workerModel, workerMessages, false, opts,
    (full) => opts.onDelta('worker', full));

  // ── Phase 3: Brain reviews the worker output and synthesizes the final answer ──
  opts.onPhase('brain-final', '🧠 Brain — synthesizing');
  const finalMessages: Message[] = [
    {
      role: 'system',
      content:
        'You are the BRAIN. Review the worker\'s output for correctness and completeness, fix any issues, ' +
        'and produce the final answer to the user\'s original request. Respond directly to the user.',
    },
    { role: 'user', content: `Original request:\n${task}` },
    { role: 'assistant', content: `Worker output:\n${workerOutput}` },
    { role: 'user', content: 'Produce the final, polished answer for the user.' },
  ];
  const finalAnswer = await streamChat(opts.brainModel, finalMessages, true, opts,
    (full) => opts.onDelta('brain-final', full));

  return finalAnswer;
}

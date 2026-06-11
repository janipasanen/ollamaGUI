/**
 * Many-models conversation (#126): send one prompt to 2-3 models and render
 * their replies as sibling responses under one user turn.
 *
 * HARDWARE CONSTRAINT: models on the SAME local Ollama connection run
 * SEQUENTIALLY (one fully completes/unloads before the next starts) to avoid
 * swapping/OOM on 8 GB machines. Models on DISTINCT connections may run
 * concurrently. A memory warning is shown when two locals on the same host
 * are selected.
 */
import type { Message } from './ollama';
import type { ModelConnection, ConnectedModel } from './connections';

/** One model's reply within a group */
export interface ModelReply {
  /** Matches a model name or ConnectedModel.id */
  modelId: string;
  /** Human-readable label shown as a badge */
  label: string;
  content: string;
  /** 'streaming' while in progress, 'done', or 'error' */
  state: 'pending' | 'streaming' | 'done' | 'error';
  error?: string;
}

export interface ModelGroup {
  /** Which user-turn index this group belongs to */
  userTurnIndex: number;
  replies: ModelReply[];
  /** Which reply was chosen to continue the conversation (index into replies) */
  chosenIndex?: number;
}

/**
 * Determine whether two model selections share the same local Ollama host.
 * Returns true if ≥2 of the selected models resolve to the same local baseUrl.
 */
export function hasSameHostConflict(
  modelIds: string[],
  defaultBaseUrl: string,
  connectedModels: ConnectedModel[],
  connections: ModelConnection[]
): boolean {
  const hostCounts: Record<string, number> = {};
  for (const id of modelIds) {
    const cm = connectedModels.find(m => m.id === id);
    if (cm) {
      const conn = connections.find(c => c.id === cm.connectionId);
      if (conn) {
        const key = conn.baseUrl.replace(/\/$/, '');
        hostCounts[key] = (hostCounts[key] ?? 0) + 1;
        continue;
      }
    }
    // Not in connectedModels → default Ollama host
    const key = defaultBaseUrl.replace(/\/$/, '');
    hostCounts[key] = (hostCounts[key] ?? 0) + 1;
  }
  return Object.values(hostCounts).some(n => n >= 2);
}

/**
 * Group model IDs by connection host so callers can run same-host models
 * sequentially and different-host models in parallel.
 *
 * Returns an array of "batches"; within each batch all models share the same
 * host. Batches themselves may be launched concurrently.
 */
export function groupByHost(
  modelIds: string[],
  defaultBaseUrl: string,
  connectedModels: ConnectedModel[],
  connections: ModelConnection[]
): { host: string; models: string[] }[] {
  const hostMap: Record<string, string[]> = {};
  for (const id of modelIds) {
    const cm = connectedModels.find(m => m.id === id);
    let host = defaultBaseUrl.replace(/\/$/, '');
    if (cm) {
      const conn = connections.find(c => c.id === cm.connectionId);
      if (conn) host = conn.baseUrl.replace(/\/$/, '');
    }
    if (!hostMap[host]) hostMap[host] = [];
    hostMap[host].push(id);
  }
  return Object.entries(hostMap).map(([host, models]) => ({ host, models }));
}

/**
 * Run a many-models fan-out.
 *
 * - Same-host models run SEQUENTIALLY (order within the batch).
 * - Different-host batches run in PARALLEL.
 * - Each model's streaming progress is reported via onUpdate.
 * - Cancellation is handled via the AbortSignal.
 */
export async function runManyModels(
  modelIds: string[],
  messages: Message[],
  onUpdate: (modelId: string, delta: string, state: ModelReply['state'], error?: string) => void,
  options: {
    defaultBaseUrl: string;
    connectedModels: ConnectedModel[];
    connections: ModelConnection[];
    genOptions?: { temperature?: number; num_ctx?: number };
    signal?: AbortSignal;
    streamOllama: (model: string, messages: Message[], onChunk: (chunk: any) => void, endpoint: string, isCloud: boolean, genOptions?: any, signal?: AbortSignal) => Promise<void>;
    streamOpenAi?: (conn: ModelConnection, model: string, messages: Message[], onChunk: (delta: string) => void, opts?: { temperature?: number }, signal?: AbortSignal) => Promise<void>;
  }
): Promise<void> {
  const { defaultBaseUrl, connectedModels, connections, genOptions, signal, streamOllama, streamOpenAi } = options;
  const batches = groupByHost(modelIds, defaultBaseUrl, connectedModels, connections);

  // Batches (different hosts) run in parallel
  await Promise.allSettled(batches.map(async ({ models: batchModels }) => {
    // Within a batch (same host) run sequentially
    for (const modelId of batchModels) {
      if (signal?.aborted) break;
      onUpdate(modelId, '', 'streaming');
      try {
        const cm = connectedModels.find(m => m.id === modelId);
        const conn = cm ? connections.find(c => c.id === cm.connectionId) : undefined;

        if (conn?.kind === 'openai' && cm && streamOpenAi) {
          await streamOpenAi(conn, cm.name, messages, (delta) => onUpdate(modelId, delta, 'streaming'), { temperature: genOptions?.temperature }, signal);
        } else {
          // Default Ollama path
          const actualModel = cm?.name ?? modelId;
          const endpoint = conn ? `${conn.baseUrl.replace(/\/$/, '')}/api/chat` : `${defaultBaseUrl.replace(/\/$/, '')}/api/chat`;
          await streamOllama(actualModel, messages, (chunk: any) => {
            if (chunk.message?.content) onUpdate(modelId, chunk.message.content, 'streaming');
          }, endpoint, false, genOptions, signal);
        }
        onUpdate(modelId, '', 'done');
      } catch (e) {
        if (signal?.aborted) { onUpdate(modelId, '', 'done'); break; }
        onUpdate(modelId, '', 'error', e instanceof Error ? e.message : 'Stream failed');
      }
    }
  }));
}

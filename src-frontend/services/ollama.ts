export interface MessageFeedback {
  thumbs: 'up' | 'down';
  comment?: string;
  model: string;
  ts: number;
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  images?: string[];
  name?: string;
  tool_calls?: any[];
  /** Local-only thumbs rating on assistant messages (#137). */
  feedback?: MessageFeedback;
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  message?: { role: string; content: string };
  response: string;
  done: boolean;
}

/** Ollama generation options (subset). num_ctx is the key lever on small-RAM machines. */
export interface GenerationOptions {
  num_ctx?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop?: string[];
}

/** Drop undefined/NaN fields; return undefined if nothing meaningful is set. */
export function cleanGenerationOptions(options?: GenerationOptions): GenerationOptions | undefined {
  if (!options) return undefined;
  const entries = Object.entries(options).filter(([, v]) =>
    v !== undefined && v !== null && !(typeof v === 'number' && Number.isNaN(v)));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export async function fetchOllamaChatStream(
  model: string,
  messages: Message[],
  onChunk: (chunk: Partial<OllamaResponse>) => void,
  endpoint: string = 'http://localhost:11434/api/chat',
  isCloudModel: boolean = false,
  options?: GenerationOptions,
  signal?: AbortSignal
): Promise<void> {
  const apiEndpoint = isCloudModel ? 'https://cloud.ollama.ai/api/chat' : endpoint;
  const cleaned = cleanGenerationOptions(options);
  const response = await fetch(apiEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true, ...(cleaned ? { options: cleaned } : {}) }),
    signal,
  });

  if (!response.ok) throw new Error(`Ollama API error: ${response.statusText}`);

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) throw new Error('Response body is null');

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split('\n')) {
      if (!line.trim()) continue;
      try {
        onChunk(JSON.parse(line));
      } catch (e) {
        console.error('Error parsing stream chunk', e);
      }
    }
  }
}

export async function fetchOllamaModels(
  endpoint: string = 'http://localhost:11434/api/tags',
  includeCloudModels: boolean = false
): Promise<{ name: string; cloud: boolean }[]> {
  const response = await fetch(endpoint, { method: 'GET' });
  if (!response.ok) throw new Error(`Ollama API error: ${response.statusText}`);
  const data = await response.json();
  
  const localModels = data.models?.map((m: any) => ({ 
    name: m.name, 
    cloud: false 
  })) || [];
  
  if (includeCloudModels) {
    return localModels;
  }
  
  return localModels;
}

export function isCloudModel(modelName: string): boolean {
  const CLOUD_SUFFIXES = ['-cloud', ':cloud'];
  return CLOUD_SUFFIXES.some(suffix => modelName.includes(suffix));
}

export async function fetchCloudModels(): Promise<{ name: string; cloud: boolean }[]> {
  return [
    { name: 'gemma4:31b-cloud', cloud: true },
    { name: 'nemotron-3-ultra:cloud', cloud: true },
    { name: 'gpt-oss:20b-cloud', cloud: true },
    { name: 'gpt-oss:120b-cloud', cloud: true },
    { name: 'ministral-3:14b-cloud', cloud: true },
    { name: 'devstral-small-2:24b-cloud', cloud: true },
    { name: 'devstral-2:123b-cloud', cloud: true },
    { name: 'deepseek-v4-pro:cloud', cloud: true },
  ];
}

/** A curated local model the user can download with one click. */
export interface SuggestedModel {
  /** Exact `ollama pull` tag. */
  name: string;
  /** Human-friendly display name. */
  label: string;
  /** One-line description. */
  description: string;
  /** Approximate download size in GB. */
  sizeGB: number;
  /** Recommended minimum system RAM in GB to run comfortably. */
  minRamGB: number;
  /** Highlighted as the recommended default for modest hardware. */
  recommended?: boolean;
}

/**
 * Curated models to suggest for one-click download, ordered lightest-first.
 * `ministral-3:3b` is recommended as a strong default that runs on 8 GB RAM.
 */
export const SUGGESTED_MODELS: SuggestedModel[] = [
  { name: 'ministral-3:3b', label: 'Ministral 3B', description: 'Compact Mistral model — great quality-to-size balance, runs on 8 GB RAM.', sizeGB: 2.0, minRamGB: 8, recommended: true },
  { name: 'llama3.2:1b', label: 'Llama 3.2 1B', description: "Meta's tiniest model — fastest, runs almost anywhere.", sizeGB: 1.3, minRamGB: 4 },
  { name: 'gemma2:2b', label: 'Gemma 2 2B', description: "Google's efficient small model.", sizeGB: 1.6, minRamGB: 8 },
  { name: 'llama3.2:3b', label: 'Llama 3.2 3B', description: "Meta's small general-purpose model.", sizeGB: 2.0, minRamGB: 8 },
  { name: 'qwen2.5:3b', label: 'Qwen 2.5 3B', description: 'Strong multilingual + reasoning for its size.', sizeGB: 1.9, minRamGB: 8 },
  { name: 'phi3:mini', label: 'Phi-3 Mini', description: "Microsoft's 3.8B model, strong at reasoning.", sizeGB: 2.2, minRamGB: 8 },
  { name: 'qwen2.5-coder:7b', label: 'Qwen 2.5 Coder 7B', description: 'Coding-focused model; needs more memory.', sizeGB: 4.7, minRamGB: 16 },
  { name: 'llama3.1:8b', label: 'Llama 3.1 8B', description: 'Higher-quality general model; 16 GB+ RAM.', sizeGB: 4.7, minRamGB: 16 },
];

export async function pullOllamaModel(
  modelName: string,
  onProgress: (progress: { status?: string; completed?: number; total?: number }) => void,
  endpoint: string = 'http://localhost:11434/api/pull'
): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName }),
  });

  if (!response.ok) throw new Error(`Ollama pull error: ${response.statusText}`);

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) throw new Error('Response body is null');

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split('\n')) {
      if (!line.trim()) continue;
      try {
        onProgress(JSON.parse(line));
      } catch (e) {
        console.error('Error parsing pull chunk', e);
      }
    }
  }
}

export async function deleteOllamaModel(
  modelName: string,
  endpoint: string = 'http://localhost:11434/api/delete'
): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName }),
  });
  if (!response.ok) throw new Error(`Ollama delete error: ${response.statusText}`);
}

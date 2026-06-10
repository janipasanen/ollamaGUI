export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  images?: string[];
  name?: string;
  tool_calls?: any[];
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  message?: { role: string; content: string };
  response: string;
  done: boolean;
}

export async function fetchOllamaChatStream(
  model: string,
  messages: Message[],
  onChunk: (chunk: Partial<OllamaResponse>) => void,
  endpoint: string = 'http://localhost:11434/api/chat',
  isCloudModel: boolean = false
): Promise<void> {
  const apiEndpoint = isCloudModel ? 'https://cloud.ollama.ai/api/chat' : endpoint;
  const response = await fetch(apiEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
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

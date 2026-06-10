export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
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
  _includeCloudModels: boolean = false
): Promise<{ name: string }[]> {
  const response = await fetch(endpoint, { method: 'GET' });
  if (!response.ok) throw new Error(`Ollama API error: ${response.statusText}`);
  const data = await response.json();
  return data.models ?? [];
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

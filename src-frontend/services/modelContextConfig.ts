/**
 * Context Window Configuration Per Model
 * =======================================
 * 
 * Manages user-configured context window limits for each model/connection.
 * 
 * Storage: localStorage key `model_context_config_v1`
 * Format:
 * {
 *   "connectionId/modelName": {
 *     "contextWindow": number,        // e.g., 32768 or 131072 (128k)
 *     "compactionThreshold": number,  // e.g., 0.8 (80% of context window)
 *     "autoDetected": boolean         // true if auto-detected from API call
 *   }
 * }
 */

const STORAGE_KEY = 'model_context_config_v1';

export interface ModelContextConfig {
  /** Context window in tokens */
  contextWindow: number;
  /** Compaction threshold as fraction of context (0.0 - 1.0) */
  compactionThreshold: number;
  /** True if value was auto-detected from API call */
  autoDetected: boolean;
}

export interface ModelContextConfigEntry {
  contextWindow: number;
  compactionThreshold: number;
  autoDetected: boolean;
}

const DEFAULT_COMPACTION_THRESHOLD = 0.8;

/**
 * Load all model context configurations from localStorage
 */
export function loadModelContextConfigs(): Map<string, ModelContextConfig> {
  const configs = new Map<string, ModelContextConfig>();
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return configs;
    
    const data = JSON.parse(stored) as Record<string, ModelContextConfigEntry>;
    for (const [modelId, config] of Object.entries(data)) {
      configs.set(modelId, {
        contextWindow: config.contextWindow,
        compactionThreshold: config.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD,
        autoDetected: config.autoDetected ?? false,
      });
    }
  } catch (e) {
    console.error('Failed to load model context configs:', e);
  }
  
  return configs;
}

/**
 * Save all model context configurations to localStorage
 */
export function saveModelContextConfigs(configs: Map<string, ModelContextConfig>): void {
  try {
    const data: Record<string, ModelContextConfigEntry> = {};
    for (const [modelId, config] of configs.entries()) {
      data[modelId] = {
        contextWindow: config.contextWindow,
        compactionThreshold: config.compactionThreshold,
        autoDetected: config.autoDetected,
      };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save model context configs:', e);
  }
}

/**
 * Get context configuration for a specific model
 * @param modelId - Format: "connectionId/modelName" or just modelName
 */
export function getModelContextConfig(
  modelId: string,
  defaultContextWindow: number = 32768,
): ModelContextConfig {
  const configs = loadModelContextConfigs();
  
  if (configs.has(modelId)) {
    return configs.get(modelId)!;
  }
  
  // Return defaults
  return {
    contextWindow: defaultContextWindow,
    compactionThreshold: DEFAULT_COMPACTION_THRESHOLD,
    autoDetected: false,
  };
}

/**
 * Set/update context configuration for a model
 */
export function setModelContextConfig(
  modelId: string,
  config: Partial<ModelContextConfig>,
): void {
  const configs = loadModelContextConfigs();
  
  const existing = configs.get(modelId) ?? {
    contextWindow: getModelDefaultContext(),
    compactionThreshold: DEFAULT_COMPACTION_THRESHOLD,
    autoDetected: false,
  };
  
  const updated: ModelContextConfig = {
    ...existing,
    ...config,
  };
  
  configs.set(modelId, updated);
  saveModelContextConfigs(configs);
}

/**
 * Remove context configuration for a model (reset to defaults)
 */
export function removeModelContextConfig(modelId: string): void {
  const configs = loadModelContextConfigs();
  configs.delete(modelId);
  saveModelContextConfigs(configs);
}

/**
 * Get default context window based on RAM
 */
export function getModelDefaultContext(): number {
  // Match autoNumCtx logic from ollama.ts - use a reasonable default that matches RAM detection
  // Since we can't do async here, return a sensible default (32k = ~16GB RAM)
  return 32768;
}

/**
 * Detect context window from API response
 * @param endpoint - Base URL of the server (http://localhost:11434 or http://gx10:1234)
 * @param modelName - Model name to query
 */
export async function detectContextFromApi(
  endpoint: string,
  modelName: string,
): Promise<number | null> {
  try {
    // Try Ollama-style /api/show first
    const ollamaRes = await fetch(`${endpoint}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName }),
    });
    
    if (ollamaRes.ok) {
      const data = await ollamaRes.json();
      const info = data.model_info ?? {};
      const ctxKey = Object.keys(info).find(k => k.endsWith('.context_length'));
      if (ctxKey) {
        return Number(info[ctxKey]);
      }
    }
    
    // Try OpenAI-compatible /v1/models endpoint
    const openaiRes = await fetch(`${endpoint}/v1/models`, {
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (openaiRes.ok) {
      const data = await openaiRes.json() as { data?: Array<{ id: string; context_length?: number }> };
      const modelData = data.data?.find(m => m.id === modelName);
      if (modelData?.context_length) {
        return Number(modelData.context_length);
      }
    }
    
    return null;
  } catch (e) {
    console.error(`Failed to detect context for ${modelName} at ${endpoint}:`, e);
    return null;
  }
}

/**
 * Build model ID from connection and model name
 */
export function buildModelId(connectionId: string, modelName: string): string {
  // Remove any existing prefix that might be there
  const cleanName = modelName.startsWith(`${connectionId}/`) 
    ? modelName.substring(modelName.indexOf('/') + 1) 
    : modelName;
  return `${connectionId}/${cleanName}`;
}

/**
 * Get compacted context threshold based on configuration
 */
export function getCompactionThreshold(config: ModelContextConfig): number {
  return config.contextWindow * config.compactionThreshold;
}

/**
 * Detect the context window for a specific model/connection from the server's
 * API, then persist it under `model_context_config_v1` (marked autoDetected).
 *
 * This is the production entry point for GAP #G9 "context window tuning". The
 * underlying detection (`detectContextFromApi`) existed and was unit-tested in
 * isolation, but nothing called it — this wires the auto-detect feature into
 * the Provider Configuration UI.
 *
 * @param endpoint - Server base URL, e.g. `http://localhost:11434`
 *                     or `http://gx10:1234` (LM Studio).
 * @param connectionId - Owning connection id, used to build the storage key.
 * @param modelName - Model tag, e.g. `llama3:8b`.
 * @returns the detected context window in tokens, or `null` if detection
 *          failed or the server exposed no context limit.
 */
export async function detectContextWindow(
  endpoint: string,
  connectionId: string,
  modelName: string,
): Promise<number | null> {
  const detected = await detectContextFromApi(endpoint, modelName);
  if (typeof detected !== 'number' || !Number.isFinite(detected) || detected <= 0) {
    return null;
  }
  setModelContextConfig(buildModelId(connectionId, modelName), {
    contextWindow: detected,
    compactionThreshold: DEFAULT_COMPACTION_THRESHOLD,
    autoDetected: true,
  });
  return detected;
}

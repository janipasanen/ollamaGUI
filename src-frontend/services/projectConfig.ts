/**
 * Project-level configuration loader (#553).
 *
 * Reads config.json from project root with provider configurations.
 * Falls back to localStorage if file is missing or invalid.
 */

import type { ModelConnection } from './connections';

export type { ModelConnection };

export interface ConfigProvider {
  id: string;
  name: string;
  type: 'ollama' | 'lmstudio' | 'ollama_cloud';
  baseUrl: string;
  enabled?: boolean;
  apiKey?: string;
  /** Optional default model tag (e.g. "qwen3-coder:latest"). Preserved on save. */
  defaultModel?: string;
}

export interface ProjectConfig {
  version: number;
  providers: ConfigProvider[];
}

const CONFIG_FILE_NAME = 'config.json';

/**
 * Load project configuration from config.json in project root.
 * Returns undefined if file doesn't exist or is invalid.
 */
export async function loadProjectConfig(): Promise<ProjectConfig | undefined> {
  try {
    // Check for config.json in current directory
    const response = await fetch(CONFIG_FILE_NAME);
    if (!response.ok) {
      // File doesn't exist - this is expected for most projects
      return undefined;
    }
    
    const text = await response.text();
    const config: ProjectConfig = JSON.parse(text);
    
    // Validate basic structure
    if (config.version !== 1 || !Array.isArray(config.providers)) {
      console.warn('Invalid config.json structure');
      return undefined;
    }
    
    return config;
  } catch (error) {
    console.warn(`Failed to load ${CONFIG_FILE_NAME}:`, error);
    return undefined;
  }
}

/**
 * Convert ConfigProvider to ModelConnection for compatibility.
 */
export function configProviderToConnection(provider: ConfigProvider): ModelConnection {
  const kind = provider.type === 'ollama' ? 'ollama' : 'openai';
  
  return {
    id: provider.id,
    name: provider.name,
    kind,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    enabled: provider.enabled ?? true,
    defaultModel: provider.defaultModel,
  };
}

/**
 * Load providers from config.json, falling back to localStorage defaults.
 */
export async function loadProvidersFromConfig(): Promise<ModelConnection[]> {
  const config = await loadProjectConfig();
  
  if (config) {
    // Use config.json providers
    return config.providers.map(configProviderToConnection);
  }
  
  // Fall back to localStorage-based connections
  // This will be handled by existing connections.ts code
  return [];
}

/**
 * Save configuration to config.json in project root.
 * Returns true on success, false otherwise.
 */
export async function saveProjectConfig(config: ProjectConfig): Promise<boolean> {
  try {
    const response = await fetch(CONFIG_FILE_NAME, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config, null, 2),
    });
    
    return response.ok;
  } catch (error) {
    console.warn(`Failed to save ${CONFIG_FILE_NAME}:`, error);
    return false;
  }
}

/**
 * Convert stored model connections back to ProjectConfig and persist to
 * config.json. Only writes when a config.json already exists (never creates
 * one out of nowhere, and never drops localStorage-only connections). Existing
 * per-provider `defaultModel` values that are not stored on the connection
 * object are preserved. Returns true on success.
 */
export async function saveProjectConfigFromConnections(
  connections: ModelConnection[]
): Promise<boolean> {
  try {
    const existing = await loadProjectConfig();
    if (!existing || !Array.isArray(existing.providers)) {
      // No existing config to update — leave it untouched.
      return false;
    }

    const existingById = new Map<string, ConfigProvider>();
    for (const p of existing.providers) existingById.set(p.id, p);

    const providers = connections.map((conn) => {
      const existing = existingById.get(conn.id);
      const provider: ConfigProvider = {
        id: conn.id,
        name: conn.name,
        type: conn.kind === 'ollama' ? 'ollama' : 'lmstudio',
        baseUrl: conn.baseUrl,
        enabled: conn.enabled,
      };
      if (conn.apiKey) provider.apiKey = conn.apiKey;
      if (conn.defaultModel) provider.defaultModel = conn.defaultModel;
      if (existing?.defaultModel && !provider.defaultModel) provider.defaultModel = existing.defaultModel;
      return provider;
    });

    return await saveProjectConfig({ version: 1, providers });
  } catch (error) {
    console.warn('Failed to save config.json:', error);
    return false;
  }
}

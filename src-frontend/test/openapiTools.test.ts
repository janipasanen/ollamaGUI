import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toolRegistry } from '../services/tools';

// Mock Tauri invoke — captured in tests to inspect calls
let _invokeImpl: ((cmd: string, args?: any) => any) | null = null;
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: any) => {
    if (_invokeImpl) return _invokeImpl(cmd, args);
    throw new Error(`unexpected invoke: ${cmd}`);
  },
}));

// Minimal OpenAPI 3.x spec used across tests
const PET_SPEC = {
  servers: [{ url: 'https://pets.example.com/api' }],
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List all pets',
        parameters: [{ name: 'limit', in: 'query', description: 'Max results', schema: { type: 'integer' } }],
      },
      post: {
        operationId: 'createPet',
        summary: 'Create a pet',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { name: { type: 'string', description: 'Pet name' } },
                required: ['name'],
              },
            },
          },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        operationId: 'getPet',
        summary: 'Get a pet by ID',
        parameters: [{ name: 'petId', in: 'path', description: 'Pet ID', required: true, schema: { type: 'string' } }],
      },
      delete: {
        // no operationId — should synthesize name
        summary: 'Delete a pet',
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
      },
    },
  },
};

import {
  specToToolDefinitions,
  operationToToolDefinition,
  registerOpenApiServer,
  unregisterOpenApiServer,
  addOpenApiServer,
  removeOpenApiServer,
  loadOpenApiServers,
  saveOpenApiServers,
} from '../services/openapiTools';

describe('OpenAPI tool servers (#129)', () => {
  beforeEach(() => {
    localStorage.clear();
    _invokeImpl = null;
    // Clean up any registered openapi tools
    const toRemove = toolRegistry.getAllTools().filter(t => t.name.includes('__'));
    toRemove.forEach(t => toolRegistry.unregisterTool(t.name));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Spec → ToolDefinition mapping ──────────────────────────────────────────

  it('maps GET /pets to a tool with query params', () => {
    const tools = specToToolDefinitions('pet_server', PET_SPEC as any, { baseUrl: undefined });
    const listPets = tools.find(t => t.name === 'pet_server__listPets');
    expect(listPets).toBeDefined();
    expect(listPets!.description).toBe('List all pets');
    expect(listPets!.parameters.properties).toHaveProperty('limit');
    expect(listPets!.parameters.properties.limit.type).toBe('integer');
  });

  it('maps POST /pets with requestBody schema to tool params', () => {
    const tools = specToToolDefinitions('pet_server', PET_SPEC as any, { baseUrl: undefined });
    const createPet = tools.find(t => t.name === 'pet_server__createPet');
    expect(createPet).toBeDefined();
    expect(createPet!.parameters.properties).toHaveProperty('name');
    expect(createPet!.parameters.required).toContain('name');
  });

  it('maps path param for GET /pets/{petId}', () => {
    const tools = specToToolDefinitions('pet_server', PET_SPEC as any, { baseUrl: undefined });
    const getPet = tools.find(t => t.name === 'pet_server__getPet');
    expect(getPet).toBeDefined();
    expect(getPet!.parameters.properties).toHaveProperty('petId');
    expect(getPet!.parameters.required).toContain('petId');
  });

  it('synthesizes tool name when operationId is absent', () => {
    const tools = specToToolDefinitions('pet_server', PET_SPEC as any, { baseUrl: undefined });
    const delPet = tools.find(t => t.name.startsWith('pet_server__delete_'));
    expect(delPet).toBeDefined();
    expect(delPet!.description).toBe('Delete a pet');
  });

  it('uses spec servers[0].url as baseUrl when none provided', () => {
    const tools = specToToolDefinitions('pet_server', PET_SPEC as any, { baseUrl: undefined });
    // Check that execute builds the correct URL by inspecting invoke args
    const calls: any[] = [];
    _invokeImpl = (cmd, args) => {
      calls.push({ cmd, args });
      return { success: true, status: 200, body: JSON.stringify([]) };
    };
    const listPets = tools.find(t => t.name === 'pet_server__listPets')!;
    return listPets.execute({ limit: 5 }).then(() => {
      expect(calls[0].args.request.url).toBe('https://pets.example.com/api/pets?limit=5');
    });
  });

  it('overrides baseUrl when provided in config', () => {
    const tools = specToToolDefinitions('pet_server', PET_SPEC as any, {
      baseUrl: 'https://custom.example.com/v2',
    });
    const calls: any[] = [];
    _invokeImpl = (cmd, args) => {
      calls.push(args);
      return { success: true, status: 200, body: JSON.stringify([]) };
    };
    return tools.find(t => t.name === 'pet_server__listPets')!.execute({}).then(() => {
      expect(calls[0].request.url).toContain('https://custom.example.com/v2/pets');
    });
  });

  // ── Request construction ────────────────────────────────────────────────────

  it('substitutes path params into URL', () => {
    const tools = specToToolDefinitions('pet_server', PET_SPEC as any, { baseUrl: undefined });
    const calls: any[] = [];
    _invokeImpl = (cmd, args) => { calls.push(args); return { success: true, status: 200, body: '"ok"' }; };
    return tools.find(t => t.name === 'pet_server__getPet')!.execute({ petId: 'abc-123' }).then(() => {
      expect(calls[0].request.url).toBe('https://pets.example.com/api/pets/abc-123');
    });
  });

  it('sends requestBody as JSON', () => {
    const tools = specToToolDefinitions('pet_server', PET_SPEC as any, { baseUrl: undefined });
    const calls: any[] = [];
    _invokeImpl = (cmd, args) => { calls.push(args); return { success: true, status: 200, body: '{"id":1}' }; };
    return tools.find(t => t.name === 'pet_server__createPet')!.execute({ name: 'Fido' }).then(result => {
      expect(calls[0].request.method).toBe('POST');
      expect(JSON.parse(calls[0].request.body)).toEqual({ name: 'Fido' });
      expect(result).toEqual({ id: 1 });
    });
  });

  it('injects Authorization Bearer header when apiKey is set', () => {
    const tool = operationToToolDefinition(
      'svc', 'get', '/items',
      { operationId: 'listItems', summary: 'List items', parameters: [] },
      'https://api.example.com',
      { apiKey: 'secret-key', apiKeyHeader: undefined }
    );
    const calls: any[] = [];
    _invokeImpl = (cmd, args) => { calls.push(args); return { success: true, status: 200, body: '[]' }; };
    return tool.execute({}).then(() => {
      expect(calls[0].request.headers['Authorization']).toBe('Bearer secret-key');
    });
  });

  it('injects custom header when apiKeyHeader is set', () => {
    const tool = operationToToolDefinition(
      'svc', 'get', '/items',
      { operationId: 'listItems', summary: 'List', parameters: [] },
      'https://api.example.com',
      { apiKey: 'my-token', apiKeyHeader: 'X-API-Key' }
    );
    const calls: any[] = [];
    _invokeImpl = (cmd, args) => { calls.push(args); return { success: true, status: 200, body: '{}' }; };
    return tool.execute({}).then(() => {
      expect(calls[0].request.headers['X-API-Key']).toBe('my-token');
    });
  });

  it('throws when server returns non-success status', () => {
    const tool = operationToToolDefinition(
      'svc', 'get', '/items',
      { operationId: 'listItems', summary: 'List', parameters: [] },
      'https://api.example.com',
      {}
    );
    _invokeImpl = () => ({ success: false, status: 403, body: 'Forbidden' });
    return expect(tool.execute({})).rejects.toThrow('403');
  });

  // ── Enable / disable filtering ──────────────────────────────────────────────

  it('registerOpenApiServer registers tools into toolRegistry', async () => {
    _invokeImpl = (cmd) => {
      if (cmd === 'mcp_http_request') return { success: true, status: 200, body: JSON.stringify(PET_SPEC) };
      throw new Error(cmd);
    };
    await registerOpenApiServer({
      id: 'pets', name: 'Pets API', specUrl: 'https://pets.example.com/openapi.json',
      enabled: true,
    });
    expect(toolRegistry.getTool('pets__listPets')).toBeDefined();
    expect(toolRegistry.getTool('pets__createPet')).toBeDefined();
    expect(toolRegistry.getTool('pets__getPet')).toBeDefined();
  });

  it('registerOpenApiServer skips registration when enabled=false', async () => {
    _invokeImpl = () => ({ success: true, status: 200, body: JSON.stringify(PET_SPEC) });
    await registerOpenApiServer({
      id: 'pets_off', name: 'Pets Off', specUrl: 'https://pets.example.com/openapi.json',
      enabled: false,
    });
    expect(toolRegistry.getTool('pets_off__listPets')).toBeUndefined();
  });

  it('unregisterOpenApiServer removes previously registered tools', async () => {
    _invokeImpl = () => ({ success: true, status: 200, body: JSON.stringify(PET_SPEC) });
    await registerOpenApiServer({
      id: 'pets2', name: 'Pets 2', specUrl: 'https://pets.example.com/openapi.json',
      enabled: true,
    });
    expect(toolRegistry.getTool('pets2__listPets')).toBeDefined();
    unregisterOpenApiServer('pets2');
    expect(toolRegistry.getTool('pets2__listPets')).toBeUndefined();
  });

  it('removed tools are absent from getOllamaToolDefinitions', async () => {
    _invokeImpl = () => ({ success: true, status: 200, body: JSON.stringify(PET_SPEC) });
    await registerOpenApiServer({
      id: 'pets3', name: 'Pets 3', specUrl: 'https://pets.example.com/openapi.json',
      enabled: true,
    });
    const beforeCount = toolRegistry.getOllamaToolDefinitions().filter(t => t.function.name.startsWith('pets3__')).length;
    expect(beforeCount).toBeGreaterThan(0);
    unregisterOpenApiServer('pets3');
    const afterCount = toolRegistry.getOllamaToolDefinitions().filter(t => t.function.name.startsWith('pets3__')).length;
    expect(afterCount).toBe(0);
  });

  // ── Persistence (localStorage) ───────────────────────────────────────────────

  it('addOpenApiServer persists and returns a config with generated id', () => {
    const cfg = addOpenApiServer({ name: 'My API', specUrl: 'https://my.api/openapi.json', enabled: true });
    expect(cfg.id).toBeTruthy();
    expect(loadOpenApiServers()).toHaveLength(1);
    expect(loadOpenApiServers()[0].name).toBe('My API');
  });

  it('removeOpenApiServer removes from localStorage', () => {
    const cfg = addOpenApiServer({ name: 'API', specUrl: 'https://a.example.com/openapi.json', enabled: true });
    removeOpenApiServer(cfg.id);
    expect(loadOpenApiServers()).toHaveLength(0);
  });

  it('saveOpenApiServers + loadOpenApiServers round-trips', () => {
    const configs = [
      { id: 'a', name: 'A', specUrl: 'https://a.com/spec', enabled: true },
      { id: 'b', name: 'B', specUrl: 'https://b.com/spec', enabled: false, apiKey: 'k' },
    ];
    saveOpenApiServers(configs);
    expect(loadOpenApiServers()).toEqual(configs);
  });
});

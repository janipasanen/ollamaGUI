import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readFile, writeFile, listDir, applyEdit, setWorkspaceRoot, getWorkspaceRoot,
  registerFileTools, _mocks,
  type DirEntry,
} from '../services/fileTools';
import { toolRegistry } from '../services/tools';

const FAKE_ROOT = '/workspace';

function mockFs(handlers: Record<string, unknown>) {
  _mocks.invoke = async (cmd, args) => {
    if (cmd === 'set_workspace_root') return undefined;
    if (cmd in handlers) return handlers[cmd];
    throw new Error(`Unexpected command: ${cmd}`);
  };
  return handlers;
}

beforeEach(() => {
  _mocks.invoke = null;
});

afterEach(() => {
  _mocks.invoke = null;
});

describe('setWorkspaceRoot (#82)', () => {
  it('calls set_workspace_root and stores the path', async () => {
    let calledWith = '';
    _mocks.invoke = async (cmd, args) => {
      if (cmd === 'set_workspace_root') { calledWith = (args as any).path; return undefined; }
      throw new Error('unexpected');
    };
    await setWorkspaceRoot(FAKE_ROOT);
    expect(calledWith).toBe(FAKE_ROOT);
    expect(getWorkspaceRoot()).toBe(FAKE_ROOT);
  });
});

describe('readFile (#82)', () => {
  it('returns the file content from Tauri', async () => {
    mockFs({ read_file: 'hello world' });
    const content = await readFile(`${FAKE_ROOT}/hello.txt`);
    expect(content).toBe('hello world');
  });

  it('propagates Tauri errors', async () => {
    _mocks.invoke = async () => { throw new Error('Permission denied'); };
    await expect(readFile(`${FAKE_ROOT}/secret.txt`)).rejects.toThrow('Permission denied');
  });
});

describe('writeFile (#82)', () => {
  it('calls write_file with path and content', async () => {
    let captured: Record<string, unknown> = {};
    _mocks.invoke = async (cmd, args) => { captured = args; return undefined; };
    await writeFile(`${FAKE_ROOT}/new.ts`, 'export {};');
    expect(captured.path).toBe(`${FAKE_ROOT}/new.ts`);
    expect(captured.content).toBe('export {};');
  });
});

describe('listDir (#82)', () => {
  const entries: DirEntry[] = [
    { name: 'src', path: `${FAKE_ROOT}/src`, is_dir: true, size: 0, modified_ms: null },
    { name: 'package.json', path: `${FAKE_ROOT}/package.json`, is_dir: false, size: 512, modified_ms: 1700000000000 },
  ];

  it('returns directory entries', async () => {
    mockFs({ list_dir: entries });
    const result = await listDir(FAKE_ROOT);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('src');
    expect(result[0].is_dir).toBe(true);
  });
});

describe('applyEdit (#82)', () => {
  it('passes path, old_string, new_string to Tauri', async () => {
    let captured: Record<string, unknown> = {};
    _mocks.invoke = async (_cmd, args) => { captured = args; return undefined; };
    await applyEdit(`${FAKE_ROOT}/file.ts`, 'const x = 1', 'const x = 2');
    expect(captured.old_string).toBe('const x = 1');
    expect(captured.new_string).toBe('const x = 2');
  });

  it('propagates "not found" error from Tauri', async () => {
    _mocks.invoke = async () => { throw new Error('old_string not found in file.'); };
    await expect(applyEdit(`${FAKE_ROOT}/f.ts`, 'missing', 'x')).rejects.toThrow('not found');
  });
});

describe('registerFileTools (#83)', () => {
  beforeEach(() => {
    registerFileTools();
  });

  afterEach(() => {
    for (const name of ['read_file', 'write_file', 'list_dir', 'apply_edit']) {
      toolRegistry.unregisterTool(name);
    }
  });

  it('registers read_file, write_file, list_dir, apply_edit in toolRegistry', () => {
    expect(toolRegistry.getTool('read_file')).toBeDefined();
    expect(toolRegistry.getTool('write_file')).toBeDefined();
    expect(toolRegistry.getTool('list_dir')).toBeDefined();
    expect(toolRegistry.getTool('apply_edit')).toBeDefined();
  });

  it('read_file tool returns { content }', async () => {
    _mocks.invoke = async () => '// hello';
    const tool = toolRegistry.getTool('read_file')!;
    const result = await tool.execute({ path: 'src/app.ts' });
    expect((result as any).content).toBe('// hello');
  });

  it('write_file tool returns { success: true }', async () => {
    _mocks.invoke = async () => undefined;
    const tool = toolRegistry.getTool('write_file')!;
    const result = await tool.execute({ path: 'out.txt', content: 'data' });
    expect((result as any).success).toBe(true);
  });

  it('list_dir tool returns { entries }', async () => {
    const fakeEntries: DirEntry[] = [
      { name: 'index.ts', path: '/w/index.ts', is_dir: false, size: 100, modified_ms: null },
    ];
    _mocks.invoke = async () => fakeEntries;
    const tool = toolRegistry.getTool('list_dir')!;
    const result = await tool.execute({ path: '/w' });
    expect((result as any).entries).toHaveLength(1);
  });

  it('apply_edit tool returns { success: true }', async () => {
    _mocks.invoke = async () => undefined;
    const tool = toolRegistry.getTool('apply_edit')!;
    const result = await tool.execute({ path: 'f.ts', old_string: 'a', new_string: 'b' });
    expect((result as any).success).toBe(true);
  });
});

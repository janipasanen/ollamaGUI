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

  it('registers search_files and glob_files (#420)', () => {
    expect(toolRegistry.getTool('search_files')).toBeDefined();
    expect(toolRegistry.getTool('glob_files')).toBeDefined();
    expect(toolRegistry.getTool('search_files')?.readOnly).toBe(true);
    expect(toolRegistry.getTool('glob_files')?.readOnly).toBe(true);
  });

  it('search_files tool passes options and returns { count, hits } (#420)', async () => {
    let captured: any = null;
    _mocks.invoke = async (cmd, args) => {
      captured = { cmd, args };
      return [{ file: 'src/a.ts', line: 3, text: 'const x = 1' }];
    };
    const tool = toolRegistry.getTool('search_files')!;
    const result = await tool.execute({ query: 'const', is_regex: false, include_glob: 'src/**/*.ts' });
    expect(captured.cmd).toBe('search_files');
    expect(captured.args.query).toBe('const');
    expect(captured.args.includeGlob).toBe('src/**/*.ts');
    expect((result as any).count).toBe(1);
    expect((result as any).hits[0].line).toBe(3);
  });

  it('glob_files tool passes pattern and returns { count, files } (#420)', async () => {
    let captured: any = null;
    _mocks.invoke = async (cmd, args) => {
      captured = { cmd, args };
      return ['src/a.ts', 'src/b.ts'];
    };
    const tool = toolRegistry.getTool('glob_files')!;
    const result = await tool.execute({ pattern: 'src/**/*.ts' });
    expect(captured.cmd).toBe('glob_files');
    expect(captured.args.pattern).toBe('src/**/*.ts');
    expect((result as any).count).toBe(2);
    expect((result as any).files).toContain('src/b.ts');
  });

  it('read_file tool forwards offset/limit (#422)', async () => {
    let captured: any = null;
    _mocks.invoke = async (cmd, args) => { captured = { cmd, args }; return 'line3\nline4'; };
    const tool = toolRegistry.getTool('read_file')!;
    const result = await tool.execute({ path: 'big.ts', offset: 3, limit: 2 });
    expect(captured.args.offset).toBe(3);
    expect(captured.args.limit).toBe(2);
    expect((result as any).content).toBe('line3\nline4');
  });

  it('registers move_file, copy_file, create_directory, delete_file (#421)', () => {
    expect(toolRegistry.getTool('move_file')).toBeDefined();
    expect(toolRegistry.getTool('copy_file')).toBeDefined();
    expect(toolRegistry.getTool('create_directory')).toBeDefined();
    expect(toolRegistry.getTool('delete_file')).toBeDefined();
    // Mutating file ops must NOT be readOnly (so autonomy gates them).
    expect(toolRegistry.getTool('move_file')?.readOnly).toBeFalsy();
    expect(toolRegistry.getTool('delete_file')?.readOnly).toBeFalsy();
  });

  it('move_file tool invokes move_path with { from, to } (#421)', async () => {
    let captured: any = null;
    _mocks.invoke = async (cmd, args) => { captured = { cmd, args }; return undefined; };
    const tool = toolRegistry.getTool('move_file')!;
    const result = await tool.execute({ from: 'a.ts', to: 'b.ts' });
    expect(captured.cmd).toBe('move_path');
    expect(captured.args).toMatchObject({ from: 'a.ts', to: 'b.ts' });
    expect((result as any).success).toBe(true);
  });
});

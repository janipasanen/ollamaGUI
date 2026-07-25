import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractSymbols, registerCodeNavTools } from '../services/codeNav';
import { toolRegistry } from '../services/tools';
import { _mocks as fsMocks } from '../services/fileTools';

beforeEach(() => { fsMocks.invoke = null; });
afterEach(() => { fsMocks.invoke = null; });

describe('extractSymbols (#426)', () => {
  it('extracts TS functions, classes, interfaces, types, enums, arrow consts', () => {
    const src = [
      'export function foo() {}',           // 1
      'async function bar() {}',            // 2
      'export class Baz {}',                // 3
      'interface Qux { a: number }',        // 4
      'export type Alias = string;',        // 5
      'enum Color { Red }',                 // 6
      'export const handler = async () => {}', // 7
      'const notASymbol = 5;',              // 8 (no paren → not captured as function)
    ].join('\n');
    const syms = extractSymbols(src, 'ts');
    const byName = Object.fromEntries(syms.map(s => [s.name, s]));
    expect(byName.foo).toMatchObject({ kind: 'function', line: 1 });
    expect(byName.bar).toMatchObject({ kind: 'function', line: 2 });
    expect(byName.Baz).toMatchObject({ kind: 'class', line: 3 });
    expect(byName.Qux.kind).toBe('interface');
    expect(byName.Alias.kind).toBe('type');
    expect(byName.Color.kind).toBe('enum');
    expect(byName.handler).toMatchObject({ kind: 'function', line: 7 });
    expect(byName.notASymbol).toBeUndefined();
  });

  it('extracts Rust fn/struct/enum/trait/impl', () => {
    const src = [
      'pub fn run() {}',
      'struct Engine {}',
      'pub enum State { A }',
      'trait Draw {}',
      'impl Engine {}',
    ].join('\n');
    const syms = extractSymbols(src, 'rs');
    const kinds = Object.fromEntries(syms.map(s => [s.name, s.kind]));
    expect(kinds.run).toBe('fn');
    expect(kinds.Engine).toBe('struct'); // first match on the struct line
    expect(kinds.State).toBe('enum');
    expect(kinds.Draw).toBe('trait');
  });

  it('extracts Python def/class', () => {
    const syms = extractSymbols('def go():\n    pass\nclass Thing:\n    pass', 'py');
    expect(syms.map(s => s.name)).toEqual(['go', 'Thing']);
  });
});

describe('code nav tools (#426/#427)', () => {
  it('registers list_symbols, find_references, go_to_definition as readOnly', () => {
    registerCodeNavTools();
    for (const n of ['list_symbols', 'find_references', 'go_to_definition']) {
      expect(toolRegistry.getTool(n)).toBeDefined();
      expect(toolRegistry.getTool(n)?.readOnly).toBe(true);
    }
  });

  it('list_symbols reads the file and returns an outline', async () => {
    registerCodeNavTools();
    fsMocks.invoke = async (cmd) => {
      if (cmd === 'read_file') return 'export function alpha() {}\nexport class Beta {}';
      throw new Error('unexpected ' + cmd);
    };
    const res = await toolRegistry.getTool('list_symbols')!.execute({ path: 'src/x.ts' });
    expect((res as any).count).toBe(2);
    expect((res as any).symbols[0]).toMatchObject({ name: 'alpha', kind: 'function' });
  });

  it('find_references greps with a word-boundary regex', async () => {
    registerCodeNavTools();
    let captured: any = null;
    fsMocks.invoke = async (cmd, args) => {
      if (cmd === 'search_files') { captured = args; return [{ file: 'a.ts', line: 2, text: 'foo()' }]; }
      throw new Error('unexpected ' + cmd);
    };
    const res = await toolRegistry.getTool('find_references')!.execute({ symbol: 'foo' });
    expect(captured.isRegex).toBe(true);
    expect(captured.query).toContain('\\bfoo\\b');
    expect((res as any).count).toBe(1);
  });
});

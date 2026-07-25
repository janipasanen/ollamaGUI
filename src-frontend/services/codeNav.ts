/**
 * Code navigation tools for the agent (#426, #427).
 *
 * - list_symbols: a lightweight, language-aware outline of a file (top-level
 *   functions/classes/types) so the agent can grasp structure without reading
 *   the whole file.
 * - find_references / go_to_definition: grep-backed symbol navigation built on
 *   the search_files tool (#420). Not a full LSP, but resolves call sites and
 *   likely definitions across the workspace.
 */

import { toolRegistry } from './tools';
import { readFile, searchFiles } from './fileTools';

export interface SymbolEntry {
  name: string;
  kind: string;
  line: number;
}

const EXT_RE = /\.([a-z0-9]+)$/i;

// Ordered [regex, kind] rules. Each regex must capture the symbol name in group 1.
const TS_RULES: Array<[RegExp, string]> = [
  [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/, 'function'],
  [/^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/, 'class'],
  [/^\s*(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/, 'interface'],
  [/^\s*(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*[=<]/, 'type'],
  [/^\s*(?:export\s+)?enum\s+([A-Za-z0-9_$]+)/, 'enum'],
  [/^\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/, 'function'],
];

const RUST_RULES: Array<[RegExp, string]> = [
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/, 'fn'],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z0-9_]+)/, 'struct'],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z0-9_]+)/, 'enum'],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z0-9_]+)/, 'trait'],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z0-9_]+)/, 'mod'],
  [/^\s*impl(?:<[^>]*>)?\s+([A-Za-z0-9_:<>]+)/, 'impl'],
];

const PY_RULES: Array<[RegExp, string]> = [
  [/^\s*def\s+([A-Za-z0-9_]+)/, 'def'],
  [/^\s*class\s+([A-Za-z0-9_]+)/, 'class'],
];

function rulesFor(ext: string): Array<[RegExp, string]> {
  switch (ext.toLowerCase()) {
    case 'ts': case 'tsx': case 'js': case 'jsx': case 'mjs': case 'cjs':
      return TS_RULES;
    case 'rs':
      return RUST_RULES;
    case 'py':
      return PY_RULES;
    default:
      return TS_RULES; // reasonable default for C-like languages
  }
}

/** Extract a top-level symbol outline from file `content` (#426). Pure/testable. */
export function extractSymbols(content: string, ext: string): SymbolEntry[] {
  const rules = rulesFor(ext);
  const out: SymbolEntry[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [re, kind] of rules) {
      const m = re.exec(line);
      if (m && m[1]) {
        out.push({ name: m[1], kind, line: i + 1 });
        break; // one symbol per line
      }
    }
  }
  return out;
}

function extOf(path: string): string {
  const m = EXT_RE.exec(path);
  return m ? m[1] : '';
}

export function registerCodeNavTools(): void {
  toolRegistry.registerTool({
    name: 'list_symbols',
    description:
      'Return a structural outline of a file (top-level functions, classes, types, etc.) with line ' +
      'numbers, so you can understand its shape without reading the whole file. Supports TS/JS, Rust, Python.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path within the workspace.' },
      },
      required: ['path'],
    },
    execute: async (params: Record<string, unknown>) => {
      const path = params.path as string;
      const content = await readFile(path);
      const symbols = extractSymbols(content, extOf(path));
      return { count: symbols.length, symbols };
    },
  });

  toolRegistry.registerTool({
    name: 'find_references',
    description:
      'Find where a symbol (function/type/variable name) is used across the workspace. Grep-backed, ' +
      'word-boundary matched. Returns file:line hits including the definition.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'The identifier to find references to.' },
        include_glob: { type: 'string', description: 'Optional path glob to restrict the search.' },
      },
      required: ['symbol'],
    },
    execute: async (params: Record<string, unknown>) => {
      const symbol = params.symbol as string;
      // Word-boundary regex so `foo` doesn't match `foobar`.
      const hits = await searchFiles(`\\b${escapeRegex(symbol)}\\b`, {
        isRegex: true,
        caseSensitive: true,
        includeGlob: params.include_glob as string | undefined,
        maxResults: 300,
      });
      return { count: hits.length, hits };
    },
  });

  toolRegistry.registerTool({
    name: 'go_to_definition',
    description:
      'Locate the likely definition(s) of a symbol across the workspace (function/class/type/const, ' +
      'or Rust fn/struct/enum/trait). Grep-backed heuristic; returns the most probable file:line(s).',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'The identifier to locate the definition of.' },
      },
      required: ['symbol'],
    },
    execute: async (params: Record<string, unknown>) => {
      const s = escapeRegex(params.symbol as string);
      // Definition-shaped patterns across common languages.
      const pattern =
        `(function|class|interface|type|enum|const|let|var|fn|struct|trait|mod|def)\\s+${s}\\b` +
        `|\\b${s}\\s*[:=]\\s*(async\\s*)?\\(`;
      const hits = await searchFiles(pattern, { isRegex: true, caseSensitive: true, maxResults: 50 });
      return { count: hits.length, definitions: hits };
    },
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

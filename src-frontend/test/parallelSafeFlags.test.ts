import { describe, it, expect, afterEach } from 'vitest';
import { toolRegistry } from '../services/tools';
import { registerFileTools } from '../services/fileTools';
import { registerCodeNavTools } from '../services/codeNav';
import { registerDocumentTools } from '../services/documentTools';
import { registerDevTools } from '../services/devTools';

// #587 — read-only, independent tools must opt in via `parallelSafe` so the
// batch executor can run them concurrently; mutating tools must not.
describe('parallelSafe tool flags (#587)', () => {
  afterEach(() => {
    for (const tool of toolRegistry.getAllTools()) {
      toolRegistry.unregisterTool(tool.name);
    }
  });

  const parallelSafeTools = [
    'read_file',
    'list_dir',
    'search_files',
    'glob_files',
    'list_symbols',
    'find_references',
    'go_to_definition',
    'document_read',
    'document_formats',
    'pdf_info',
    'pdf_extract',
    'review_diff',
  ];

  const mutatingTools = [
    'write_file',
    'apply_edit',
    'apply_patch',
    'move_file',
    'copy_file',
    'create_directory',
    'delete_file',
  ];

  beforeEach(() => {
    registerFileTools();
    registerCodeNavTools();
    registerDocumentTools();
    registerDevTools();
  });

  it('marks read-only, independent tools as parallelSafe', () => {
    for (const name of parallelSafeTools) {
      const tool = toolRegistry.getTool(name);
      expect(tool, `${name} should be registered`).toBeDefined();
      expect(tool?.parallelSafe, `${name} should be parallelSafe`).toBe(true);
    }
  });

  it('does NOT mark mutating tools as parallelSafe', () => {
    for (const name of mutatingTools) {
      const tool = toolRegistry.getTool(name);
      expect(tool, `${name} should be registered`).toBeDefined();
      expect(tool?.parallelSafe, `${name} must not be parallelSafe`).toBeFalsy();
    }
  });

  it('the parallelSafe tools are all read-only', () => {
    for (const name of parallelSafeTools) {
      const tool = toolRegistry.getTool(name);
      expect(tool?.readOnly, `${name} should be read-only`).toBe(true);
    }
  });
});

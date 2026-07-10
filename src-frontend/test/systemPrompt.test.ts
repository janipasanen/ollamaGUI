/**
 * System prompt composition (#92, #93, #95): stacks rules file, project
 * instructions, memory block, and the base prompt in a defined order.
 */
import { describe, it, expect } from 'vitest';
import { composeSystemPrompt } from '../services/systemPrompt';

describe('composeSystemPrompt (#92/#93/#95)', () => {
  it('returns just the base prompt when no context sources are provided', () => {
    expect(composeSystemPrompt({ systemPrompt: 'You are helpful.' })).toBe('You are helpful.');
  });

  it('stacks rules → instructions → memory → base in order', () => {
    const out = composeSystemPrompt({
      systemPrompt: 'BASE',
      rulesFileContent: 'RULES',
      projectInstructions: 'INSTR',
      memoryBlock: 'MEMORY',
    });
    const parts = out.split('\n\n');
    expect(parts[0]).toContain('--- Project Rules ---');
    expect(parts[0]).toContain('RULES');
    expect(parts[1]).toContain('--- Project Instructions ---');
    expect(parts[1]).toContain('INSTR');
    expect(parts[2]).toBe('MEMORY');
    expect(parts[3]).toBe('BASE');
  });

  it('skips empty/whitespace-only context sources but keeps the base', () => {
    const out = composeSystemPrompt({
      systemPrompt: 'BASE',
      rulesFileContent: '   ',
      projectInstructions: '',
      memoryBlock: undefined,
    });
    expect(out).toBe('BASE');
  });

  it('trims surrounding whitespace from each source', () => {
    const out = composeSystemPrompt({
      systemPrompt: 'BASE',
      rulesFileContent: '\n  RULES  \n',
    });
    expect(out).toContain('RULES');
    expect(out).not.toContain('  RULES  ');
  });

  it('includes the memory block as-is (no header wrapper)', () => {
    const out = composeSystemPrompt({ systemPrompt: 'BASE', memoryBlock: 'remember: x' });
    expect(out).toBe('remember: x\n\nBASE');
  });
});

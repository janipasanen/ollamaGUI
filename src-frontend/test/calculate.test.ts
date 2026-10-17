import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { toolRegistry, evaluateArithmetic, registerBuiltInTools } from '../services/tools';

// #612: the `calculate` tool used `new Function('return (...)')`, which could
// execute arbitrary code from a model-supplied expression. It now uses a safe
// arithmetic parser; this file covers both the parser and the tool.

describe('#612 evaluateArithmetic (safe parser)', () => {
  it('evaluates simple expressions with correct precedence', () => {
    expect(evaluateArithmetic('1 + 2 * 3')).toBe(7);
    expect(evaluateArithmetic('(1 + 2) * 3')).toBe(9);
    expect(evaluateArithmetic('2 * 3 + 4 - 1')).toBe(9);
    expect(evaluateArithmetic('10 / 2 / 5')).toBe(1);
    expect(evaluateArithmetic('7 % 3')).toBe(1);
    expect(evaluateArithmetic('1.5 + 2.5')).toBe(4);
  });

  it('handles unary minus and parentheses', () => {
    expect(evaluateArithmetic('-5 + 3')).toBe(-2);
    expect(evaluateArithmetic('-(3 + 4)')).toBe(-7);
    expect(evaluateArithmetic('2 * (-3)')).toBe(-6);
    expect(evaluateArithmetic('((1 + 2))')).toBe(3);
  });

  it('supports scientific notation', () => {
    expect(evaluateArithmetic('1e3')).toBe(1000);
    expect(evaluateArithmetic('2.5e-1')).toBe(0.25);
    expect(evaluateArithmetic('1 + 1e2')).toBe(101);
  });

  it('supports the fixed Math functions and constants', () => {
    expect(evaluateArithmetic('sqrt(16)')).toBe(4);
    expect(evaluateArithmetic('pow(2, 10)')).toBe(1024);
    expect(evaluateArithmetic('min(3, 7, 2)')).toBe(2);
    expect(evaluateArithmetic('max(3, 7, 2)')).toBe(7);
    expect(evaluateArithmetic('abs(-4)')).toBe(4);
    expect(Math.abs(evaluateArithmetic('PI') - Math.PI) < 1e-12).toBe(true);
    expect(Math.abs(evaluateArithmetic('E') - Math.E) < 1e-12).toBe(true);
  });

  it('rejects arbitrary identifiers / code (throws, no eval)', () => {
    expect(() => evaluateArithmetic('process.exit(1)')).toThrow();
    expect(() => evaluateArithmetic("fetch('/')")).toThrow();
    expect(() => evaluateArithmetic('a = 1')).toThrow();
    expect(() => evaluateArithmetic('1;2')).toThrow();
    expect(() => evaluateArithmetic('window.process')).toThrow();
    expect(() => evaluateArithmetic('[]; 1')).toThrow();
  });

  it('rejects stray/unsupported characters', () => {
    expect(() => evaluateArithmetic('')).toThrow();
    expect(() => evaluateArithmetic('1 2')).toThrow();
    expect(() => evaluateArithmetic('@')).toThrow();
    expect(() => evaluateArithmetic('2 & 3')).toThrow();
  });
});

describe('#612 calculate tool', () => {
  beforeEach(() => registerBuiltInTools());

  const calculate = () => toolRegistry.getTool('calculate')!;

  it('executes a valid expression and returns a finite number', async () => {
    const res = await calculate().execute({ expression: '2 * (3 + 4)' });
    expect(res).toEqual({ result: 14 });
  });

  it('never evaluates injected code — returns an error instead', async () => {
    for (const expr of ['process.exit(1)', 'fetch("/")', 'a = 1', '1;2', 'window.process', '[]; 1', '2 & 3']) {
      const res = await calculate().execute({ expression: expr });
      expect(res).toHaveProperty('error');
      expect(res).not.toHaveProperty('result');
    }
  });

  it('marks the code-executing tool as NOT readOnly (#612 invariant)', async () => {
    expect(calculate().readOnly).toBeFalsy();
  });

  it('every registered code-exec tool is never readOnly (#612 invariant)', async () => {
    // Built-in + run_python (pyodide) are the only code-execution tools. Any
    // tool whose name signals execution must NOT be flagged readOnly.
    const codeExecNames = toolRegistry.getAllTools()
      .map((t) => t.name)
      .filter((n) => n === 'calculate' || n === 'run_python');
    expect(codeExecNames).toContain('calculate');
    for (const name of codeExecNames) {
      expect(toolRegistry.getTool(name)?.readOnly).toBeFalsy();
    }
  });
});

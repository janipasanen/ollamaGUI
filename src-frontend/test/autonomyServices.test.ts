/**
 * Service-level contracts behind autonomy-by-default (#549 audit ranks 2-3):
 * binary-level CLI allowlisting, the shared devTools approval path, and
 * RAM/model-aware context auto-sizing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cliAllowlist, commandBinary, isCommandAllowlisted, requestCliApproval, CORE_AGENT_TOOLS } from '../services/tools';
import {
  autoNumCtx,
  clearCapabilitiesCache,
  getBuiltInModelProfile,
  getModelCapabilities,
  type ModelCapabilities,
} from '../services/ollama';

beforeEach(() => {
  cliAllowlist.clear();
  clearCapabilitiesCache();
});

describe('binary-level CLI allowlist (#549 rank 2)', () => {
  it('commandBinary extracts the first token', () => {
    expect(commandBinary('npm run build')).toBe('npm');
    expect(commandBinary('  git   status')).toBe('git');
    expect(commandBinary('')).toBe('');
  });

  it('an allowlisted binary covers every command line using it', () => {
    cliAllowlist.add('npm');
    expect(isCommandAllowlisted('npm test')).toBe(true);
    expect(isCommandAllowlisted('npm run build')).toBe(true);
    expect(isCommandAllowlisted('yarn build')).toBe(false);
  });

  it('legacy exact-string entries still match', () => {
    cliAllowlist.add('echo hello');
    expect(isCommandAllowlisted('echo hello')).toBe(true);
    expect(isCommandAllowlisted('echo other')).toBe(false);
  });

  it('requestCliApproval passes allowlisted commands without a callback', async () => {
    cliAllowlist.add('git');
    await expect(requestCliApproval('git diff')).resolves.toBe(true);
  });
});

describe('autoNumCtx (#549 rank 3)', () => {
  const caps = (contextLength: number | null): ModelCapabilities => ({ contextLength, tools: null });
  const GB = 1024 ** 3;

  it('caps at the model native window', () => {
    expect(autoNumCtx(caps(8192), 64 * GB, true)).toBe(8192);
  });

  it('caps at the RAM budget for big-window models', () => {
    expect(autoNumCtx(caps(131072), 16 * GB, true)).toBe(16384);
    expect(autoNumCtx(caps(131072), 8 * GB, true)).toBe(8192);
  });

  it('plain chat stays leaner than agentic on big machines', () => {
    expect(autoNumCtx(caps(131072), 32 * GB, false)).toBe(8192);
    expect(autoNumCtx(caps(131072), 32 * GB, true)).toBe(32768);
  });

  it('never drops below the 4096 floor', () => {
    expect(autoNumCtx(caps(2048), 4 * GB, true)).toBe(4096);
    expect(autoNumCtx(caps(null as unknown as number), null, false)).toBeGreaterThanOrEqual(4096);
  });

  it('unknown capabilities fall back to the RAM budget', () => {
    expect(autoNumCtx(null, 16 * GB, true)).toBe(16384);
  });

  it('honours a built-in remote profile instead of local RAM limits', () => {
    expect(autoNumCtx({ contextLength: 262144, contextSource: 'built-in', tools: true }, 8 * GB, false))
      .toBe(262144);
  });
});

describe('built-in model profiles', () => {
  it('recognizes the Ornith 256k custom model', () => {
    expect(getBuiltInModelProfile('janimpasanen/ornith-1.5-256k-jani:35b')).toEqual({
      contextLength: 262144,
      tools: true,
    });
  });

  it('matches profile names case-insensitively and ignores surrounding whitespace', () => {
    expect(getBuiltInModelProfile('  JANIMPASANEN/ORNITH-1.5-256K-JANI:35B ')).toEqual({
      contextLength: 262144,
      tools: true,
    });
  });

  it('does not assign metadata to unknown models', () => {
    expect(getBuiltInModelProfile('llama3:8b')).toBeNull();
  });

  it('fills missing Ollama metadata from the profile', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ model_info: {} }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getModelCapabilities('janimpasanen/ornith-1.5-256k-jani:35b', 'http://ollama'))
      .resolves.toEqual({ contextLength: 262144, tools: true, contextSource: 'built-in' });
  });
});

describe('core agent toolset (#549 rank 3)', () => {
  it('is a small, editing-focused working set', () => {
    expect(CORE_AGENT_TOOLS.length).toBeLessThanOrEqual(16);
    for (const t of ['read_file', 'write_file', 'apply_edit', 'run_shell_command', 'run_tests', 'update_plan']) {
      expect(CORE_AGENT_TOOLS).toContain(t);
    }
  });
});

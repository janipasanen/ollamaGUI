import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPresets, savePresets, addPreset, updatePreset, removePreset,
  loadActivePresetId, setActivePreset, clearActivePreset, getActivePreset,
  applyPreset, type ModelPreset,
} from '../services/presets';

beforeEach(() => localStorage.clear());

describe('Model presets — CRUD and persistence (#124)', () => {
  it('addPreset assigns an id and persists', () => {
    const p = addPreset({
      name: 'Code Reviewer', icon: '🔍', baseModel: 'qwen2.5-coder:7b',
      systemPrompt: 'You are a code reviewer.',
      params: { temperature: 0.2, num_ctx: 4096 },
      toolNames: ['run_shell_command'],
      mcpServerIds: ['github-srv'],
      knowledgeCollectionIds: [],
    });
    expect(p.id).toBeTruthy();
    expect(loadPresets()).toHaveLength(1);
    expect(loadPresets()[0].name).toBe('Code Reviewer');
  });

  it('updatePreset patches the right entry', () => {
    const p = addPreset({ name: 'A', baseModel: 'llama3.2:1b', systemPrompt: '', params: {}, toolNames: [], mcpServerIds: [], knowledgeCollectionIds: [] });
    updatePreset(p.id, { name: 'A-updated', params: { temperature: 0.9 } });
    const updated = loadPresets().find(x => x.id === p.id)!;
    expect(updated.name).toBe('A-updated');
    expect(updated.params.temperature).toBe(0.9);
  });

  it('removePreset removes from storage', () => {
    const p = addPreset({ name: 'B', baseModel: 'llama3.2:1b', systemPrompt: '', params: {}, toolNames: [], mcpServerIds: [], knowledgeCollectionIds: [] });
    removePreset(p.id);
    expect(loadPresets()).toHaveLength(0);
  });

  it('savePresets + loadPresets round-trips', () => {
    const presets: ModelPreset[] = [
      { id: 'x', name: 'X', baseModel: 'ministral-3:3b', systemPrompt: 'Be helpful.', params: { temperature: 0.7 }, toolNames: [], mcpServerIds: [], knowledgeCollectionIds: [] },
    ];
    savePresets(presets);
    expect(loadPresets()).toEqual(presets);
  });
});

describe('Active preset management (#124)', () => {
  it('setActivePreset and loadActivePresetId round-trip', () => {
    setActivePreset('preset-abc');
    expect(loadActivePresetId()).toBe('preset-abc');
  });

  it('clearActivePreset removes the stored id', () => {
    setActivePreset('preset-xyz');
    clearActivePreset();
    expect(loadActivePresetId()).toBeNull();
  });

  it('getActivePreset returns the matching preset', () => {
    const p = addPreset({ name: 'Active', baseModel: 'ministral-3:3b', systemPrompt: 'Hi', params: {}, toolNames: [], mcpServerIds: [], knowledgeCollectionIds: [] });
    setActivePreset(p.id);
    expect(getActivePreset()?.name).toBe('Active');
  });

  it('getActivePreset returns null when no preset is active', () => {
    expect(getActivePreset()).toBeNull();
  });

  it('removePreset clears active if it was the active preset', () => {
    const p = addPreset({ name: 'C', baseModel: 'llama3.2:1b', systemPrompt: '', params: {}, toolNames: [], mcpServerIds: [], knowledgeCollectionIds: [] });
    setActivePreset(p.id);
    removePreset(p.id);
    expect(loadActivePresetId()).toBeNull();
  });
});

describe('applyPreset — sets model / systemPrompt / params (#124)', () => {
  it('applyPreset calls all setters and returns baseModel', () => {
    const preset = addPreset({
      name: 'Therapist', baseModel: 'llama3.1:8b',
      systemPrompt: 'You are a supportive therapist.',
      params: { temperature: 0.8, num_ctx: 8192 },
      toolNames: [], mcpServerIds: [], knowledgeCollectionIds: [],
    });

    let model = '';
    let prompt = '';
    let opts = {};
    const result = applyPreset(preset, {
      setModel: m => { model = m; },
      setSystemPrompt: s => { prompt = s; },
      setGenOptions: o => { opts = o; },
    });

    expect(result).toBe('llama3.1:8b');
    expect(model).toBe('llama3.1:8b');
    expect(prompt).toBe('You are a supportive therapist.');
    expect(opts).toEqual({ temperature: 0.8, num_ctx: 8192 });
  });

  it('applyPreset with empty params passes through empty object', () => {
    const p = addPreset({ name: 'Plain', baseModel: 'ministral-3:3b', systemPrompt: '', params: {}, toolNames: [], mcpServerIds: [], knowledgeCollectionIds: [] });
    let opts: any = null;
    applyPreset(p, { setModel: () => {}, setSystemPrompt: () => {}, setGenOptions: o => { opts = o; } });
    expect(opts).toEqual({});
  });
});

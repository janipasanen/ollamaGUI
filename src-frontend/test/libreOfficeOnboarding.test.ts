/**
 * LibreOffice onboarding persistence (#145): localStorage-backed state for the
 * optional conversion-engine onboarding modal, via the `_store` storage seam.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadLoState, saveLoState, markDismissed, setLoPath, needsOnboarding,
  _store, type StorageShim,
} from '../services/libreOfficeOnboarding';

function shim(): StorageShim {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => { m.set(k, v); },
  };
}

beforeEach(() => {
  _store.value = shim();
});

describe('LibreOffice onboarding state (#145)', () => {
  it('defaults to not-dismissed with no path', () => {
    expect(loadLoState()).toEqual({ dismissed: false });
  });

  it('round-trips save/load', () => {
    saveLoState({ dismissed: true, path: '/usr/bin/soffice' });
    expect(loadLoState()).toEqual({ dismissed: true, path: '/usr/bin/soffice' });
  });

  it('markDismissed sets dismissed and preserves an existing path', () => {
    setLoPath('/opt/lo/soffice');
    const next = markDismissed();
    expect(next.dismissed).toBe(true);
    expect(next.path).toBe('/opt/lo/soffice');
  });

  it('setLoPath records the path', () => {
    const next = setLoPath('/Applications/LibreOffice.app/Contents/MacOS/soffice');
    expect(next.path).toBe('/Applications/LibreOffice.app/Contents/MacOS/soffice');
    expect(loadLoState().path).toBe('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  });

  it('loadLoState drops an empty/non-string path', () => {
    saveLoState({ dismissed: false, path: '' });
    expect(loadLoState().path).toBeUndefined();
  });

  it('loadLoState survives corrupted JSON (returns default)', () => {
    const st = _store.value!;
    st.setItem('ollama_gui_libreoffice', '{not json');
    expect(loadLoState()).toEqual({ dismissed: false });
  });

  it('needsOnboarding is false when the engine is available', () => {
    expect(needsOnboarding(true)).toBe(false);
  });

  it('needsOnboarding is true when unavailable and not dismissed', () => {
    expect(needsOnboarding(false)).toBe(true);
  });

  it('needsOnboarding is false after the user dismisses', () => {
    markDismissed();
    expect(needsOnboarding(false)).toBe(false);
  });
});

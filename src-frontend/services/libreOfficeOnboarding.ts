/**
 * LibreOffice optional-engine onboarding state (#145).
 *
 * LibreOffice is an OPTIONAL local conversion engine used for the document
 * formats Pandoc cannot reach on its own (pptx/odp, and pdf rendered from
 * docx). When the engine is missing we surface a one-time onboarding modal
 * (see components/LibreOfficeOnboarding.tsx) that lets the user detect an
 * existing install, open the download page, or dismiss the prompt for good.
 *
 * This module is the localStorage-backed persistence layer for that state.
 * It mirrors the lightweight persistence style of services/memory.ts: a single
 * JSON blob under one key. A settable `_store` seam lets tests inject an
 * in-memory shim instead of touching the real localStorage.
 */

const LO_KEY = 'ollama_gui_libreoffice';

/** Persisted onboarding state for the optional LibreOffice engine. */
export interface LoState {
  /** True once the user has dismissed the onboarding prompt for good. */
  dismissed: boolean;
  /** Absolute path to a detected/selected LibreOffice (soffice) binary. */
  path?: string;
}

// ── Storage seam ──────────────────────────────────────────────────────────────
// Tests assign `_store` to an in-memory shim so they don't depend on jsdom's
// localStorage. When `_store` is null we fall back to the real localStorage.

export interface StorageShim {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const _store: { value: StorageShim | null } = { value: null };

function store(): StorageShim {
  return _store.value ?? localStorage;
}

const DEFAULT_STATE: LoState = { dismissed: false };

// ── Persistence ───────────────────────────────────────────────────────────────

/** Load the persisted state, falling back to a fresh default on any error. */
export function loadLoState(): LoState {
  try {
    const raw = store().getItem(LO_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<LoState>;
    return {
      dismissed: Boolean(parsed.dismissed),
      // Only carry a path through if it's a non-empty string.
      ...(typeof parsed.path === 'string' && parsed.path ? { path: parsed.path } : {}),
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/** Persist the full state blob. */
export function saveLoState(s: LoState): void {
  store().setItem(LO_KEY, JSON.stringify(s));
}

/** Mark the onboarding prompt as permanently dismissed and return the new state. */
export function markDismissed(): LoState {
  const next: LoState = { ...loadLoState(), dismissed: true };
  saveLoState(next);
  return next;
}

/** Record the path to a detected/selected LibreOffice binary. */
export function setLoPath(path: string): LoState {
  const next: LoState = { ...loadLoState(), path };
  saveLoState(next);
  return next;
}

// ── Derived logic ─────────────────────────────────────────────────────────────

/**
 * Whether the onboarding modal should be shown.
 *
 * We only nudge the user when the engine is genuinely unavailable AND they
 * haven't already dismissed the prompt. Once available, or once dismissed, we
 * stay quiet.
 */
export function needsOnboarding(available: boolean): boolean {
  if (available) return false;
  return !loadLoState().dismissed;
}

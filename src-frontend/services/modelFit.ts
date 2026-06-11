// Heuristic model-fit classification: will a model run comfortably in available
// memory? Compares model bytes (+ runtime/KV-cache overhead) to detected RAM (#147).

export type Fit = 'ok' | 'tight' | 'risky' | 'unknown';

export interface SystemMemory {
  total_bytes: number;
  available_bytes: number;
  apple_silicon: boolean;
}

const OVERHEAD_BYTES = 1_000_000_000; // ~1 GB runtime + KV-cache headroom
const SIZE_MARGIN = 1.2;              // models need ~20% more than on-disk size

/**
 * Classify fit against available memory. Returns 'unknown' when either the model
 * size or memory figure is missing (e.g. cloud model, or detection unavailable).
 */
export function classifyFit(modelSizeBytes: number | undefined, availableBytes: number | undefined): Fit {
  if (!modelSizeBytes || !availableBytes) return 'unknown';
  const needed = modelSizeBytes * SIZE_MARGIN + OVERHEAD_BYTES;
  const ratio = needed / availableBytes;
  if (ratio <= 0.7) return 'ok';
  if (ratio <= 1.0) return 'tight';
  return 'risky';
}

export function fitLabel(fit: Fit): string {
  switch (fit) {
    case 'ok': return 'Fits comfortably';
    case 'tight': return 'Tight fit';
    case 'risky': return 'Likely won’t fit';
    default: return 'Unknown size';
  }
}

/** Tailwind text color class for the fit dot. */
export function fitColor(fit: Fit): string {
  switch (fit) {
    case 'ok': return 'text-green-400';
    case 'tight': return 'text-amber-400';
    case 'risky': return 'text-red-400';
    default: return 'text-zinc-500';
  }
}

export function formatBytes(bytes?: number): string {
  if (!bytes) return '—';
  const gb = bytes / 1_000_000_000;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1_000_000).toFixed(0)} MB`;
}

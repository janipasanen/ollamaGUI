/**
 * Visual pixel diff service (#79).
 *
 * Compares two base64 PNG screenshots (before/after) using a canvas-based
 * pixel delta (RGBA channel difference). Returns a diff ratio (0–1) and a
 * data URL overlay where changed pixels are highlighted in red.
 *
 * For production builds where a canvas is available (Tauri webview), this
 * runs fully in-process with no dependencies. For environments without
 * canvas (Node/jsdom test), the test seam `_mocks.diff` is used.
 */

export interface DiffResult {
  diffRatio: number;
  pass: boolean;
  diffDataUrl: string;
}

/** Test seam. */
export const _mocks = {
  diff: null as ((beforeB64: string, afterB64: string, threshold: number) => Promise<DiffResult>) | null,
};

async function loadImageData(b64: string): Promise<ImageData | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, img.width, img.height));
    };
    img.onerror = () => resolve(null);
    img.src = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
  });
}

/**
 * Compute a pixel-level diff between two base64 PNG screenshots.
 *
 * @param beforeB64  Base64 or data-URL of the before screenshot.
 * @param afterB64   Base64 or data-URL of the after screenshot.
 * @param threshold  Ratio (0–1) above which the diff is considered a failure.
 *                   Default 0.01 (1%).
 */
export async function diffScreenshots(
  beforeB64: string,
  afterB64: string,
  threshold = 0.01,
): Promise<DiffResult> {
  if (_mocks.diff) return _mocks.diff(beforeB64, afterB64, threshold);

  const [beforeData, afterData] = await Promise.all([
    loadImageData(beforeB64),
    loadImageData(afterB64),
  ]);

  if (!beforeData || !afterData) {
    return { diffRatio: 0, pass: true, diffDataUrl: '' };
  }

  const { width, height } = beforeData;
  if (beforeData.width !== afterData.width || beforeData.height !== afterData.height) {
    return { diffRatio: 1, pass: false, diffDataUrl: '' };
  }

  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const ctx = outCanvas.getContext('2d')!;
  const outData = ctx.createImageData(width, height);

  let diffPixels = 0;
  const total = width * height;
  const bef = beforeData.data;
  const aft = afterData.data;
  const out = outData.data;

  for (let i = 0; i < bef.length; i += 4) {
    const dr = Math.abs(bef[i] - aft[i]);
    const dg = Math.abs(bef[i + 1] - aft[i + 1]);
    const db = Math.abs(bef[i + 2] - aft[i + 2]);
    const changed = (dr + dg + db) > 30;
    if (changed) {
      diffPixels++;
      // Highlight changed pixels in red
      out[i] = 255; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 255;
    } else {
      // Copy original pixel at 30% opacity
      out[i] = bef[i]; out[i + 1] = bef[i + 1]; out[i + 2] = bef[i + 2];
      out[i + 3] = Math.round(bef[i + 3] * 0.3);
    }
  }

  ctx.putImageData(outData, 0, 0);
  const diffDataUrl = outCanvas.toDataURL('image/png');
  const diffRatio = diffPixels / total;

  return { diffRatio, pass: diffRatio <= threshold, diffDataUrl };
}

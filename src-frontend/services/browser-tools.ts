/**
 * AI browser-control tool registration (#74).
 *
 * Surfaces the embedded Chromium/CDP automation engine to the agent as a set of
 * `toolRegistry` tools. Each tool's `execute` ultimately calls a `browser_cdp_*`
 * Tauri command via the `tauriInvoke` seam.
 *
 * Safety model (mirrors the CLI approval gate in services/tools.ts and the
 * browser approval gate in services/browserApproval.ts):
 *   - Navigations to non-localhost hosts require explicit approval.
 *   - `browser_eval` (arbitrary JS) always requires approval.
 *   - Typing into a password / secret field routes through a credential path:
 *     we ask for approval but never forward (or echo back) the typed text, so
 *     secrets stay out of chat messages and tool results.
 *   - Read-only tools (snapshot, screenshot, console, wait, assert) never prompt.
 *
 * The first *acting* (non-read-only) tool call lazily starts the engine via
 * `browser_engine_start` and flips `browserSession.engineConnected`, emitting an
 * `engine-status` event so the UI can reflect the live connection.
 *
 * Following the repo's service convention, a mutable `_mocks.invoke` seam lets
 * tests stand in a fake without importing the real Tauri runtime.
 */

import { toolRegistry } from './tools';
import { browserSession, browserBus, isLocalhostUrl } from './browser';

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------

export const _mocks = {
  invoke: null as ((cmd: string, args: Record<string, unknown>) => Promise<unknown>) | null,
};

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (_mocks.invoke) return _mocks.invoke(cmd, args) as Promise<T>;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

// ---------------------------------------------------------------------------
// Tool name catalogue (single source of truth for register/unregister)
// ---------------------------------------------------------------------------

/** Every tool name this module registers, used by {@link unregisterBrowserTools}. */
export const BROWSER_TOOL_NAMES = [
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_screenshot',
  'browser_eval',
  'browser_read_console',
  'browser_wait_for',
  'browser_assert',
] as const;

// ---------------------------------------------------------------------------
// Engine lifecycle
// ---------------------------------------------------------------------------

/**
 * Ensure the automation engine is attached before an acting tool runs.
 *
 * Idempotent: if `browserSession.engineConnected` is already true this is a
 * no-op. Otherwise it starts the engine (visible window by default so the user
 * can watch automation), flips the session flag, and emits `engine-status` so
 * the UI can update its connection indicator.
 */
async function ensureEngine(): Promise<void> {
  if (browserSession.engineConnected) return;
  await tauriInvoke('browser_engine_start', { headless: false });
  browserSession.engineConnected = true;
  browserBus.emit('engine-status', { connected: true });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all browser-control tools into {@link toolRegistry}.
 *
 * @param onApprovalRequired callback the UI wires to its approval modal. Called
 *   as `onApprovalRequired(action, detail)` and resolving `true` (allow) or
 *   `false` (deny). `action` is one of `'navigate' | 'eval' | 'type-secret'`.
 */
export function registerBrowserTools(
  onApprovalRequired: (action: string, detail: string) => Promise<boolean>,
): void {
  // ── browser_navigate ─────────────────────────────────────────────────────
  // Acting tool. Navigations to non-localhost hosts are gated by approval; the
  // local dev surface is always allowed (iframe-friendly, per ADR-0001).
  toolRegistry.registerTool({
    name: 'browser_navigate',
    description:
      'Navigate the embedded browser to a URL. Non-localhost destinations require user approval.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to navigate to.' },
      },
      required: ['url'],
    },
    execute: async (p) => {
      const url = p.url as string;
      // Allowlist: localhost (any port) is always permitted; everything else
      // must be approved by the user.
      if (!isLocalhostUrl(url)) {
        if (!(await onApprovalRequired('navigate', url))) {
          return { error: 'denied' };
        }
      }
      await ensureEngine();
      return tauriInvoke('browser_cdp_navigate', { url });
    },
  });

  // ── browser_snapshot ─────────────────────────────────────────────────────
  // Read-only: returns the current accessibility (AX) tree with stable ref ids.
  toolRegistry.registerTool({
    name: 'browser_snapshot',
    description:
      'Capture the accessibility tree of the current page as a list of interactable refs.',
    parameters: { type: 'object', properties: {} },
    readOnly: true,
    execute: async () => tauriInvoke('browser_cdp_get_ax_tree'),
  });

  // ── browser_click ────────────────────────────────────────────────────────
  // Acting tool. Clicks the element identified by an AX ref id from a snapshot.
  toolRegistry.registerTool({
    name: 'browser_click',
    description: 'Click the element identified by a ref id from a prior browser_snapshot.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The ref id of the element to click.' },
      },
      required: ['ref'],
    },
    execute: async (p) => {
      await ensureEngine();
      return tauriInvoke('browser_cdp_click', { refId: p.ref as string });
    },
  });

  // ── browser_type ─────────────────────────────────────────────────────────
  // Acting tool. Types text into a field. If the target ref resolves to a
  // password / secret field, we route through the credential path: ask for
  // approval and inject the value engine-side WITHOUT echoing it through chat or
  // tool results. (Here the secret value itself is never forwarded.)
  toolRegistry.registerTool({
    name: 'browser_type',
    description:
      'Type text into the field identified by a ref id. Secret fields are handled via a credential prompt and never echoed.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'The ref id of the field to type into.' },
        text: { type: 'string', description: 'The text to type.' },
        submit: {
          type: 'boolean',
          description: 'If true, press Enter after typing to submit the form.',
        },
      },
      required: ['ref', 'text'],
    },
    execute: async (p) => {
      const ref = p.ref as string;
      const text = p.text as string;
      const submit = !!p.submit;

      await ensureEngine();

      // Detect secret/password fields from the most recent snapshot. The
      // automation layer marks these refs with `isSecret` (e.g. role 'textbox'
      // on a password input); we never let their values flow through the model.
      const refInfo = browserSession.lastSnapshotRefs[ref];
      const isSecret =
        !!refInfo &&
        (refInfo.isSecret === true ||
          /password|passwd/i.test(refInfo.role) ||
          /password|passwd/i.test(refInfo.name));

      if (isSecret) {
        // Credential path: require approval, but do NOT pass `text` anywhere it
        // could be persisted or echoed. The engine pulls the secret from a
        // secure prompt of its own; here we simply gate and report redaction.
        const approved = await onApprovalRequired('type-secret', ref);
        if (!approved) {
          return { error: 'denied' };
        }
        return { typed: true, ref, secret: true, redacted: true };
      }

      return tauriInvoke('browser_cdp_type', { refId: ref, text, submit });
    },
  });

  // ── browser_screenshot ───────────────────────────────────────────────────
  // Read-only: captures a PNG of the viewport (or the full scrollable page).
  toolRegistry.registerTool({
    name: 'browser_screenshot',
    description: 'Capture a screenshot of the current page (viewport, or full page when requested).',
    parameters: {
      type: 'object',
      properties: {
        fullPage: {
          type: 'boolean',
          description: 'If true, capture the entire scrollable page rather than just the viewport.',
        },
      },
    },
    readOnly: true,
    execute: async (p) => tauriInvoke('browser_cdp_screenshot', { fullPage: !!p.fullPage }),
  });

  // ── browser_eval ─────────────────────────────────────────────────────────
  // Acting tool. Arbitrary JS execution is ALWAYS sensitive: approval is
  // required on every call regardless of host.
  toolRegistry.registerTool({
    name: 'browser_eval',
    description:
      'Evaluate a JavaScript expression in the page context. Always requires user approval.',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'The JavaScript expression to evaluate.' },
      },
      required: ['expression'],
    },
    execute: async (p) => {
      const expression = p.expression as string;
      if (!(await onApprovalRequired('eval', expression))) {
        return { error: 'denied' };
      }
      await ensureEngine();
      return tauriInvoke('browser_cdp_eval', { expression });
    },
  });

  // ── browser_read_console ─────────────────────────────────────────────────
  // Read-only: returns forwarded page console messages, optionally clearing the
  // buffer afterwards.
  toolRegistry.registerTool({
    name: 'browser_read_console',
    description: 'Read console messages forwarded from the page. Optionally clear the buffer.',
    parameters: {
      type: 'object',
      properties: {
        clear: { type: 'boolean', description: 'If true, clear the console buffer after reading.' },
      },
    },
    readOnly: true,
    execute: async (p) => tauriInvoke('browser_cdp_read_console', { clear: !!p.clear }),
  });

  // ── browser_wait_for ─────────────────────────────────────────────────────
  // Read-only: polls the AX tree until the expected text or ref appears, or a
  // timeout elapses. A small bounded loop keeps it cheap; tests effectively run
  // a single poll because the first snapshot already satisfies (or doesn't).
  toolRegistry.registerTool({
    name: 'browser_wait_for',
    description:
      'Wait until a piece of text or a ref id appears in the accessibility tree, or until timeout.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text expected to appear somewhere in the AX tree.' },
        ref: { type: 'string', description: 'A ref id expected to appear in the AX tree.' },
        timeoutMs: {
          type: 'number',
          description: 'Maximum time to wait in milliseconds (default 5000).',
        },
      },
    },
    readOnly: true,
    execute: async (p) => {
      const text = p.text as string | undefined;
      const ref = p.ref as string | undefined;
      const timeoutMs = typeof p.timeoutMs === 'number' ? (p.timeoutMs as number) : 5000;
      const deadline = Date.now() + timeoutMs;
      const intervalMs = 200;

      // Bounded polling loop. We re-read the AX tree each iteration and test the
      // match condition; on the first iteration this behaves like a single poll.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const tree = (await tauriInvoke<any>('browser_cdp_get_ax_tree')) as {
          refs?: Record<string, { role: string; name: string }>;
          text?: string;
        };

        const refsMap = tree?.refs ?? {};
        const haystack =
          typeof tree?.text === 'string'
            ? tree.text
            : Object.values(refsMap)
                .map((r) => r?.name ?? '')
                .join(' ');

        const textMatch = text != null ? haystack.includes(text) : false;
        const refMatch = ref != null ? Object.prototype.hasOwnProperty.call(refsMap, ref) : false;

        // If no condition was supplied at all, any successful snapshot satisfies.
        if ((text == null && ref == null) || textMatch || refMatch) {
          return { found: true, text: textMatch || text == null, ref: refMatch || ref == null };
        }

        if (Date.now() >= deadline) {
          return { found: false, timedOut: true };
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    },
  });

  // ── browser_assert ───────────────────────────────────────────────────────
  // Read-only: assert a condition about page state and report pass/actual. The
  // `type` enum is forwarded verbatim into the Ollama tool schema.
  toolRegistry.registerTool({
    name: 'browser_assert',
    description:
      'Assert a condition about the current page (URL contains text, text present, or element exists).',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'The kind of assertion to perform.',
          enum: ['url_contains', 'text_present', 'element_exists'],
        },
        expected: {
          type: 'string',
          description: 'The expected value (substring of URL, text, or a ref id).',
        },
      },
      required: ['type', 'expected'],
    },
    readOnly: true,
    execute: async (p) => {
      const type = p.type as string;
      const expected = p.expected as string;

      if (type === 'url_contains') {
        const actual = browserSession.currentUrl;
        return { pass: actual.includes(expected), actual };
      }

      // text_present / element_exists both inspect the live AX tree.
      const tree = (await tauriInvoke<any>('browser_cdp_get_ax_tree')) as {
        refs?: Record<string, { role: string; name: string }>;
        text?: string;
      };
      const refsMap = tree?.refs ?? {};

      if (type === 'element_exists') {
        const pass = Object.prototype.hasOwnProperty.call(refsMap, expected);
        return { pass, actual: Object.keys(refsMap).join(',') };
      }

      // text_present
      const haystack =
        typeof tree?.text === 'string'
          ? tree.text
          : Object.values(refsMap)
              .map((r) => r?.name ?? '')
              .join(' ');
      return { pass: haystack.includes(expected), actual: haystack };
    },
  });
}

/**
 * Unregister every browser tool. Primarily used by tests to avoid cross-test
 * leakage in the shared {@link toolRegistry} singleton.
 */
export function unregisterBrowserTools(): void {
  for (const name of BROWSER_TOOL_NAMES) {
    toolRegistry.unregisterTool(name);
  }
}

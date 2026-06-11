/**
 * Browser action approval gate (#77).
 *
 * Mirrors the CLI approval pattern: a session-only allow-list for hosts,
 * a callback that the UI wires up to show a modal, and a credential injection
 * path that keeps secrets out of chat messages.
 */

export type BrowserAction = 'navigate' | 'eval' | 'type_secret' | 'click_destructive';

export interface BrowserApprovalRequest {
  action: BrowserAction;
  detail: string;
  /** For navigate: the target URL (used to extract host for allow-listing). */
  url?: string;
}

export interface BrowserApprovalResult {
  approved: boolean;
  /** If true, add this host to the session allow-list. */
  allowHostForSession?: boolean;
  /** Secret value entered by the user (type_secret action only). NOT stored in any message. */
  secret?: string;
}

// ── Session-only allow-list (not persisted — same rationale as CLI allow-list) ─

export const browserUrlAllowlist = new Set<string>();

export function clearBrowserAllowlist(): void {
  browserUrlAllowlist.clear();
}

function extractHost(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

export function isHostAllowed(url: string): boolean {
  return browserUrlAllowlist.has(extractHost(url));
}

export function allowHost(url: string): void {
  browserUrlAllowlist.add(extractHost(url));
}

// ── Approval callback ─────────────────────────────────────────────────────────

type ApprovalCallback = (req: BrowserApprovalRequest) => Promise<BrowserApprovalResult>;

let _approvalCallback: ApprovalCallback | null = null;

export function setBrowserApprovalCallback(cb: ApprovalCallback): void {
  _approvalCallback = cb;
}

export function clearBrowserApprovalCallback(): void {
  _approvalCallback = null;
}

// ── Audit log (in-memory, session only) ──────────────────────────────────────

export interface AuditEntry {
  ts: number;
  action: BrowserAction;
  detail: string;
  approved: boolean;
}

const _auditLog: AuditEntry[] = [];

export function getAuditLog(): readonly AuditEntry[] { return _auditLog; }
export function clearAuditLog(): void { _auditLog.length = 0; }

// ── Core gate ─────────────────────────────────────────────────────────────────

/**
 * Request approval for a browser action. Returns the user's decision.
 *
 * For `navigate` actions, if the host is in `browserUrlAllowlist` the call
 * returns immediately as approved (no modal). Otherwise shows the modal.
 *
 * For `eval` actions, approval is always required (no host allow-listing).
 *
 * For `type_secret` actions, the modal collects the secret value and returns
 * it in `result.secret` — the secret is NOT added to any `Message` object.
 */
export async function requestBrowserApproval(
  req: BrowserApprovalRequest,
): Promise<BrowserApprovalResult> {
  // Navigate: check allow-list first
  if (req.action === 'navigate' && req.url && isHostAllowed(req.url)) {
    _auditLog.push({ ts: Date.now(), action: req.action, detail: req.detail, approved: true });
    return { approved: true };
  }

  if (!_approvalCallback) {
    // No UI callback registered — deny by default for safety
    _auditLog.push({ ts: Date.now(), action: req.action, detail: req.detail, approved: false });
    return { approved: false };
  }

  const result = await _approvalCallback(req);

  if (result.approved && result.allowHostForSession && req.url) {
    allowHost(req.url);
  }

  _auditLog.push({ ts: Date.now(), action: req.action, detail: req.detail, approved: result.approved });
  return result;
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  requestBrowserApproval, setBrowserApprovalCallback, clearBrowserApprovalCallback,
  browserUrlAllowlist, clearBrowserAllowlist, isHostAllowed, allowHost,
  getAuditLog, clearAuditLog,
} from '../services/browserApproval';

beforeEach(() => {
  clearBrowserAllowlist();
  clearAuditLog();
  clearBrowserApprovalCallback();
});

afterEach(() => {
  clearBrowserAllowlist();
  clearAuditLog();
  clearBrowserApprovalCallback();
});

describe('browserUrlAllowlist (#77)', () => {
  it('starts empty', () => {
    expect(browserUrlAllowlist.size).toBe(0);
  });

  it('allowHost adds the hostname (not the full URL)', () => {
    allowHost('https://github.com/org/repo');
    expect(isHostAllowed('https://github.com/')).toBe(true);
    expect(isHostAllowed('https://gitlab.com/')).toBe(false);
  });

  it('is cleared by clearBrowserAllowlist', () => {
    allowHost('https://example.com');
    clearBrowserAllowlist();
    expect(isHostAllowed('https://example.com')).toBe(false);
  });
});

describe('requestBrowserApproval — navigate (#77)', () => {
  it('denies without UI callback by default', async () => {
    const r = await requestBrowserApproval({ action: 'navigate', detail: 'Go to example.com', url: 'https://example.com' });
    expect(r.approved).toBe(false);
  });

  it('approves navigation to an allow-listed host without showing modal', async () => {
    allowHost('https://trusted.example.com');
    setBrowserApprovalCallback(async () => { throw new Error('should not be called'); });
    const r = await requestBrowserApproval({ action: 'navigate', detail: 'trusted nav', url: 'https://trusted.example.com/page' });
    expect(r.approved).toBe(true);
  });

  it('shows modal for non-allow-listed host and respects user approval', async () => {
    setBrowserApprovalCallback(async () => ({ approved: true }));
    const r = await requestBrowserApproval({ action: 'navigate', detail: 'nav', url: 'https://new.example.com' });
    expect(r.approved).toBe(true);
  });

  it('adds host to allow-list when allowHostForSession=true', async () => {
    setBrowserApprovalCallback(async () => ({ approved: true, allowHostForSession: true }));
    await requestBrowserApproval({ action: 'navigate', detail: 'nav', url: 'https://now-trusted.example.com' });
    expect(isHostAllowed('https://now-trusted.example.com')).toBe(true);
  });

  it('subsequent navigation to same host skips the modal', async () => {
    let callCount = 0;
    setBrowserApprovalCallback(async () => { callCount++; return { approved: true, allowHostForSession: true }; });
    await requestBrowserApproval({ action: 'navigate', detail: 'n1', url: 'https://skip.example.com' });
    await requestBrowserApproval({ action: 'navigate', detail: 'n2', url: 'https://skip.example.com/other' });
    expect(callCount).toBe(1); // second nav skipped modal
  });
});

describe('requestBrowserApproval — eval (#77)', () => {
  it('always prompts for eval (no host allow-list bypass)', async () => {
    let callCount = 0;
    setBrowserApprovalCallback(async () => { callCount++; return { approved: true }; });
    await requestBrowserApproval({ action: 'eval', detail: 'document.cookie' });
    await requestBrowserApproval({ action: 'eval', detail: 'document.cookie' });
    expect(callCount).toBe(2); // both prompted
  });

  it('denial returns approved=false', async () => {
    setBrowserApprovalCallback(async () => ({ approved: false }));
    const r = await requestBrowserApproval({ action: 'eval', detail: 'bad script' });
    expect(r.approved).toBe(false);
  });
});

describe('requestBrowserApproval — secret injection (#77)', () => {
  it('type_secret result carries secret value', async () => {
    setBrowserApprovalCallback(async () => ({ approved: true, secret: 's3cr3t' }));
    const r = await requestBrowserApproval({ action: 'type_secret', detail: 'fill password field' });
    expect(r.approved).toBe(true);
    expect(r.secret).toBe('s3cr3t');
  });

  it('secret is not stored in the audit log', async () => {
    setBrowserApprovalCallback(async () => ({ approved: true, secret: 'my-password' }));
    await requestBrowserApproval({ action: 'type_secret', detail: 'password fill' });
    const log = getAuditLog();
    expect(log.some(e => JSON.stringify(e).includes('my-password'))).toBe(false);
  });
});

describe('audit log (#77)', () => {
  it('records approved and denied actions', async () => {
    setBrowserApprovalCallback(async (req) => ({ approved: req.action !== 'eval' }));
    await requestBrowserApproval({ action: 'navigate', detail: 'nav', url: 'https://a.com' });
    await requestBrowserApproval({ action: 'eval', detail: 'bad' });
    const log = getAuditLog();
    expect(log).toHaveLength(2);
    expect(log[0].approved).toBe(true);
    expect(log[1].approved).toBe(false);
  });

  it('allow-listed nav is recorded as approved in audit log', async () => {
    allowHost('https://trusted.com');
    await requestBrowserApproval({ action: 'navigate', detail: 'trusted', url: 'https://trusted.com/page' });
    expect(getAuditLog()[0].approved).toBe(true);
  });
});

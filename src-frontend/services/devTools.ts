/**
 * Developer quality tools for the agent (#423, #424).
 *
 * The agent can run the project's tests and type/lint checks as first-class
 * tools — with a long timeout and a PARSED pass/fail summary — instead of the
 * approval-gated `run_shell_command` (30s cap, raw truncated stdout). This is
 * the self-verification step of an agentic coding loop.
 *
 * Both tools run in the active workspace root via the existing `run_cli`
 * infrastructure (runCliOnce). The command is configurable and persisted.
 */

import { toolRegistry, runCliOnce } from './tools';
import { getWorkspaceRoot } from './fileTools';
import { gitDiff } from './git';
import type { PostToolUseHook } from './toolHooks';

const TEST_CMD_KEY = 'ollama_gui_test_command';
const CHECK_CMD_KEY = 'ollama_gui_check_command';
/** Tests/checks routinely exceed the 30s shell default; give them 5 minutes. */
export const LONG_TIMEOUT_MS = 300_000;

export function getTestCommand(): string {
  try { return localStorage.getItem(TEST_CMD_KEY) || 'npm test'; } catch { return 'npm test'; }
}
export function setTestCommand(cmd: string): void {
  try { localStorage.setItem(TEST_CMD_KEY, cmd); } catch { /* ignore */ }
}
export function getCheckCommand(): string {
  try { return localStorage.getItem(CHECK_CMD_KEY) || 'npx tsc --noEmit'; } catch { return 'npx tsc --noEmit'; }
}
export function setCheckCommand(cmd: string): void {
  try { localStorage.setItem(CHECK_CMD_KEY, cmd); } catch { /* ignore */ }
}

export interface ParsedRun {
  passed: boolean;
  exit_code: number;
  timed_out: boolean;
  summary: string;
  failures: string[];
  output_tail: string;
}

// Lines that indicate a failure/diagnostic across common runners (vitest, jest,
// cargo, tsc, eslint). Heuristic but broadly useful.
const FAIL_LINE_RE = /(\bFAIL\b|✗|×|\bfailed\b|error(\[|:|\sTS\d)|panicked|assertion|\bError\b|not ok|warning:)/i;
// Lines that look like a run summary.
const SUMMARY_RE = /(Tests?\s+\d+|test result:|\d+\s+passed|\d+\s+failed|\d+\s+error|✓|problems?\s*\()/i;

/** Parse raw command output into a structured pass/fail summary (#423/#424). */
export function parseRunOutput(res: { stdout: string; stderr: string; exit_code: number; timed_out: boolean }): ParsedRun {
  const combined = `${res.stdout || ''}\n${res.stderr || ''}`;
  const lines = combined.split('\n');
  const failures = lines
    .filter(l => FAIL_LINE_RE.test(l))
    .map(l => l.trim())
    .filter(Boolean)
    .slice(0, 40);
  const summaryLines = lines.filter(l => SUMMARY_RE.test(l)).map(l => l.trim()).filter(Boolean).slice(-3);
  const summary = summaryLines.join(' | ')
    || (res.timed_out ? 'timed out' : res.exit_code === 0 ? 'passed' : `exited ${res.exit_code}`);
  const output_tail = lines.slice(-40).join('\n').trim();
  return {
    passed: res.exit_code === 0 && !res.timed_out,
    exit_code: res.exit_code,
    timed_out: res.timed_out,
    summary,
    failures,
    output_tail,
  };
}

/** Run a dev command in the workspace root and return a parsed summary. */
export async function runDevCommand(command: string): Promise<ParsedRun & { command: string; error?: string }> {
  const root = getWorkspaceRoot();
  if (!root) return { command, error: 'No workspace open — open a project folder first.' } as any;
  const res = await runCliOnce(command, root, LONG_TIMEOUT_MS);
  return { command, ...parseRunOutput(res) };
}

// ── Post-edit verification hook (#425) ───────────────────────────────────────

const EDIT_TOOLS = new Set(['write_file', 'apply_edit', 'apply_patch']);
const AUTO_VERIFY_KEY = 'ollama_gui_auto_verify_edits';

export function isAutoVerifyEnabled(): boolean {
  // Default ON: verification after edits is what makes autonomous runs
  // trustworthy; an explicit 'false' still disables it.
  try { return localStorage.getItem(AUTO_VERIFY_KEY) !== 'false'; } catch { return true; }
}
export function setAutoVerifyEnabled(on: boolean): void {
  try { localStorage.setItem(AUTO_VERIFY_KEY, on ? 'true' : 'false'); } catch { /* ignore */ }
}

/**
 * PostToolUse hook (#425): after a successful file edit, run the project's check
 * command and append a concise diagnostic summary to the tool result, so the
 * model self-corrects within the same run. Enabled only when `isEnabled()` is
 * true (default off) — running checks after every edit is expensive.
 */
export function makePostEditVerifyHook(isEnabled: () => boolean): PostToolUseHook {
  return async (toolName, _args, resultContent) => {
    if (!isEnabled() || !EDIT_TOOLS.has(toolName)) return { action: 'allow' };
    // Only verify if the edit actually applied.
    if (!/success"?\s*:\s*true|"applied"\s*:\s*[1-9]/.test(resultContent)) return { action: 'allow' };
    try {
      const run = await runDevCommand(getCheckCommand());
      if ((run as { error?: string }).error) return { action: 'allow' };
      if (run.passed) {
        return { action: 'transform', content: `${resultContent}\n\n[auto-verify] ✓ checks passed (${run.summary}).` };
      }
      const diag = run.failures.slice(0, 8).join('\n');
      return {
        action: 'transform',
        content: `${resultContent}\n\n[auto-verify] ✕ checks FAILED (${run.summary}). Fix these before continuing:\n${diag}`,
      };
    } catch {
      return { action: 'allow' };
    }
  };
}

// ── Diff code-review (#428) ───────────────────────────────────────────────────

export interface ReviewFinding {
  line?: number;
  category: string;
  message: string;
  snippet: string;
}

const REVIEW_RULES: Array<{ re: RegExp; category: string; message: string }> = [
  { re: /console\.(log|debug|info)\s*\(/, category: 'debug', message: 'Leftover console debug statement' },
  { re: /\bdebugger\b/, category: 'debug', message: 'Leftover debugger statement' },
  { re: /\b(println!|dbg!|eprintln!)\s*\(/, category: 'debug', message: 'Leftover Rust debug print' },
  { re: /\b(TODO|FIXME|XXX|HACK)\b/, category: 'todo', message: 'TODO/FIXME left in code' },
  { re: /\.(only|skip)\s*\(|\b(fdescribe|fit)\s*\(/, category: 'test', message: 'Focused/skipped test (.only/.skip/fit)' },
  { re: /catch\s*\([^)]*\)\s*\{\s*\}/, category: 'error-handling', message: 'Empty catch block swallows errors' },
  { re: /(api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-./+]{16,}['"]/i, category: 'secret', message: 'Possible hardcoded secret/credential' },
];

/**
 * Review the ADDED lines of a unified diff for common issues (#428).
 * Tracks new-file line numbers via hunk headers. Pure/testable.
 */
export function reviewDiffText(diff: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  let curLine = 0;
  for (const raw of diff.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { curLine = parseInt(hunk[1], 10); continue; }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      const content = raw.slice(1);
      for (const rule of REVIEW_RULES) {
        if (rule.re.test(content)) {
          findings.push({ line: curLine, category: rule.category, message: rule.message, snippet: content.trim().slice(0, 200) });
        }
      }
      curLine++;
    } else if (!raw.startsWith('-') && !raw.startsWith('\\')) {
      curLine++; // context line advances the new-file counter; removed lines do not
    }
  }
  return findings;
}

export function registerDevTools(): void {
  toolRegistry.registerTool({
    name: 'review_diff',
    description:
      'Review the current git working-tree diff (or a specific file) for common issues before committing: ' +
      'leftover debug statements, TODO/FIXME, focused/skipped tests, empty catch blocks, and possible ' +
      'hardcoded secrets. Returns structured findings with line numbers.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Optional file to review; defaults to the whole working tree.' },
      },
    },
    execute: async (params: Record<string, unknown>) => {
      const root = getWorkspaceRoot();
      if (!root) return { error: 'No workspace open — open a project folder first.' };
      const d = await gitDiff(root, params.file as string | undefined, false);
      const findings = reviewDiffText(d.diff || '');
      return { count: findings.length, findings };
    },
  });

  toolRegistry.registerTool({
    name: 'run_tests',
    description:
      'Run the project test suite and return a PARSED pass/fail summary with failing tests. ' +
      'Use after code changes to verify them. Runs in the workspace root with a 5-minute timeout ' +
      '(unlike run_shell_command, which caps at 30s). Pass a command to override the default.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Test command (optional; defaults to the configured project test command, e.g. "npm test").' },
      },
    },
    execute: async (params: Record<string, unknown>) => {
      const override = params.command as string | undefined;
      // A model-supplied command is an arbitrary shell string — route it
      // through the same approval policy as run_shell_command so 'auto' runs
      // cannot open an unaudited shell path. The configured defaults are
      // user-chosen and stay silent.
      if (override) {
        const { requestCliApproval } = await import('./tools');
        const approved = await requestCliApproval(override);
        if (!approved) return { ok: false, error: 'Command denied by user.' };
      }
      return runDevCommand(override || getTestCommand());
    },
  });

  toolRegistry.registerTool({
    name: 'run_checks',
    description:
      'Run the project type-check / lint (e.g. `tsc --noEmit`, `cargo check`, eslint) and return parsed ' +
      'diagnostics. Use to confirm edits compile. Runs in the workspace root with a 5-minute timeout. ' +
      'Pass a command to override the default.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Check command (optional; defaults to the configured project check command, e.g. "npx tsc --noEmit").' },
      },
    },
    execute: async (params: Record<string, unknown>) => {
      const override = params.command as string | undefined;
      if (override) {
        const { requestCliApproval } = await import('./tools');
        const approved = await requestCliApproval(override);
        if (!approved) return { ok: false, error: 'Command denied by user.' };
      }
      return runDevCommand(override || getCheckCommand());
    },
  });
}

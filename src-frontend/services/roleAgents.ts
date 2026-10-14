/**
 * Running a role as a sub-agent: the model for that role, its prompt, its
 * tool scope, on whichever server that model lives on.
 *
 * The two stream generators are injected so the delegation logic — role
 * resolution, tool scoping, depth guard, error reporting — is unit-testable
 * without a model server.
 */
import type { Message } from './ollama';
import type { ModelConnection } from './connections';
import {
  Role, RoleModels, DELEGATE_ROLES, ROLE_PROMPTS, isRole, toolsForRole,
} from './roles';

export interface ResolvedRouting {
  model: string;
  endpoint: string;
  conn?: ModelConnection;
  apiKey?: string;
}

export interface RunRoleDeps {
  roleModels: RoleModels;
  /** The model currently selected in the UI — the fallback for an unset role. */
  selectedModel: string;
  resolveRouting: (modelId: string) => ResolvedRouting;
  /** Names of tools that are registered and enabled right now. */
  availableTools: string[];
  runOllama: (opts: any) => AsyncGenerator<Message, void, unknown>;
  runOpenAi: (opts: any) => AsyncGenerator<Message, void, unknown>;
  onApprovalNeeded?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
  signal?: AbortSignal;
  maxIterations?: number;
  /** Progress hook so the UI can show "developer: running…". */
  onProgress?: (role: Role, status: string) => void;
}

export interface RoleResult {
  role: Role;
  model: string;
  result: string;
  error?: string;
}

/** Roles run one level deep: a delegated role cannot itself delegate. */
export async function runRole(role: Role, task: string, deps: RunRoleDeps): Promise<RoleResult> {
  if (!isRole(role) || !DELEGATE_ROLES.includes(role)) {
    return { role, model: '', result: '', error: `Unknown or non-delegable role "${role}". Use one of: ${DELEGATE_ROLES.join(', ')}.` };
  }
  if (!task || !task.trim()) {
    return { role, model: '', result: '', error: 'Empty task — describe what the role should do.' };
  }

  const modelId = deps.roleModels[role] || deps.selectedModel;
  const routing = deps.resolveRouting(modelId);
  // 'delegate_to_role' is deliberately not in any delegate role's tool list, so
  // delegation cannot recurse.
  const toolFilter = toolsForRole(role, deps.availableTools);

  let result = '';
  const messages: Message[] = [
    { role: 'system', content: ROLE_PROMPTS[role] },
    { role: 'user', content: task },
  ];
  const common = {
    model: routing.model,
    messages,
    maxIterations: deps.maxIterations ?? 8,
    toolFilter,
    signal: deps.signal,
    onApprovalNeeded: deps.onApprovalNeeded,
    onAssistantMessage: (m: string) => { result = m; },
    onToolCall: () => deps.onProgress?.(role, 'running tools'),
  };

  let failure: string | undefined;
  const capture = (e: Error) => { failure = e.message; };
  try {
    deps.onProgress?.(role, 'started');
    const gen = routing.conn
      ? deps.runOpenAi({ ...common, conn: routing.conn, onError: capture })
      : deps.runOllama({ ...common, endpoint: routing.endpoint, apiKey: routing.apiKey, onError: capture });
    for await (const _m of gen) { /* callbacks capture what we need */ }
  } catch (e: any) {
    failure = e?.message ?? String(e);
  }
  deps.onProgress?.(role, failure ? 'failed' : 'done');

  // A failed role must be visible to the organizer. An empty result with no
  // error reads as "the developer finished and had nothing to say", so the
  // organizer would carry on as if the work had been done.
  if (failure) return { role, model: modelId, result, error: failure };
  if (!result.trim()) return { role, model: modelId, result: '', error: 'The role returned no output.' };
  return { role, model: modelId, result };
}

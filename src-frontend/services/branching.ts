/**
 * Conversation branching (#98).
 *
 * Branch model: a ChatSession's `branches` field stores alternative conversation
 * histories. The active conversation in `session.messages` is always the trunk.
 * When a user edits/regenerates from message index N, the current messages[N:]
 * slice is saved as a branch and the trunk is trimmed to messages[:N], then a
 * new user message is appended and sent.
 *
 * Navigation: `activeBranchIndex` in BranchState tracks which sibling is shown
 * at each fork. Index -1 = trunk; ≥0 = branch array index.
 */

import type { Message } from './ollama';

export interface ConversationBranch {
  id: string;
  /** Message index (in the trunk) where this branch diverged */
  forkAt: number;
  /** Messages from forkAt onwards (the alternative history) */
  messages: Message[];
  createdAt: number;
}

/** Per-fork navigation state: which sibling (-1=trunk, ≥0=branch index) is visible */
export interface ForkNav {
  forkAt: number;
  activeIndex: number;  // -1 = trunk
}

export interface BranchState {
  branches: ConversationBranch[];
  forkNav: ForkNav[];
}

// ── Branch creation ───────────────────────────────────────────────────────────

/**
 * Fork the conversation at `forkAt`.
 * Saves messages[forkAt:] as a new branch; the caller should then truncate
 * `messages` to messages[:forkAt] before appending the new user message.
 * Returns the new branch (to be persisted) and updated forkNav.
 */
export function createBranch(
  messages: Message[],
  forkAt: number,
  existing: BranchState
): { branch: ConversationBranch; updated: BranchState } {
  const branch: ConversationBranch = {
    id: crypto.randomUUID(),
    forkAt,
    messages: messages.slice(forkAt),
    createdAt: Date.now(),
  };
  const updated: BranchState = {
    branches: [...existing.branches, branch],
    forkNav: upsertForkNav(existing.forkNav, forkAt, -1), // stay on trunk after fork
  };
  return { branch, updated };
}

function upsertForkNav(nav: ForkNav[], forkAt: number, activeIndex: number): ForkNav[] {
  const exists = nav.find(n => n.forkAt === forkAt);
  if (exists) return nav.map(n => n.forkAt === forkAt ? { ...n, activeIndex } : n);
  return [...nav, { forkAt, activeIndex }];
}

// ── Branch navigation ─────────────────────────────────────────────────────────

/** Count siblings (branches + trunk) at a given fork point */
export function siblingCount(forkAt: number, state: BranchState): number {
  return 1 + state.branches.filter(b => b.forkAt === forkAt).length; // 1 = trunk
}

/** Navigate to the next sibling at a fork point. Wraps around. */
export function navigateBranch(
  trunk: Message[],
  state: BranchState,
  forkAt: number,
  direction: 1 | -1
): { messages: Message[]; updated: BranchState } {
  const siblings = state.branches.filter(b => b.forkAt === forkAt);
  const nav = state.forkNav.find(n => n.forkAt === forkAt);
  const current = nav?.activeIndex ?? -1;
  const total = 1 + siblings.length;
  const next = ((current + 1 + direction + total) % total) - 1; // -1=trunk, 0..siblings.length-1

  const prefix = trunk.slice(0, forkAt);
  const tail = next === -1 ? trunk.slice(forkAt) : siblings[next]?.messages ?? [];
  const messages = [...prefix, ...tail];

  const updated: BranchState = {
    ...state,
    forkNav: upsertForkNav(state.forkNav, forkAt, next),
  };
  return { messages, updated };
}

/** Get the current sibling index (-1=trunk) and total count at a fork point */
export function getForkInfo(forkAt: number, state: BranchState): { current: number; total: number } {
  const nav = state.forkNav.find(n => n.forkAt === forkAt);
  return {
    current: nav?.activeIndex ?? -1,
    total: siblingCount(forkAt, state),
  };
}

/** All fork points that have ≥2 siblings */
export function getForkPoints(state: BranchState): number[] {
  const points = new Set(state.branches.map(b => b.forkAt));
  return [...points].sort((a, b) => a - b);
}

// ── Storage helpers ───────────────────────────────────────────────────────────

export function emptyBranchState(): BranchState {
  return { branches: [], forkNav: [] };
}

/** Migrate a plain Message[] (no branches) to a BranchState — trivially empty */
export function migrateToBranchState(_messages: Message[]): BranchState {
  return emptyBranchState();
}

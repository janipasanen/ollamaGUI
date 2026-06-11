import { describe, it, expect } from 'vitest';
import type { Message } from '../services/ollama';
import {
  createBranch,
  navigateBranch,
  getForkInfo,
  getForkPoints,
  siblingCount,
  emptyBranchState,
  migrateToBranchState,
  type BranchState,
} from '../services/branching';

function msg(role: 'user' | 'assistant', content: string): Message {
  return { role, content };
}

const SESSION: Message[] = [
  msg('user', 'Hello'),
  msg('assistant', 'Hi there'),
  msg('user', 'Tell me about cats'),
  msg('assistant', 'Cats are fascinating…'),
];

describe('emptyBranchState', () => {
  it('returns empty branches and forkNav', () => {
    const s = emptyBranchState();
    expect(s.branches).toHaveLength(0);
    expect(s.forkNav).toHaveLength(0);
  });
});

describe('migrateToBranchState', () => {
  it('returns empty state regardless of messages', () => {
    const s = migrateToBranchState(SESSION);
    expect(s.branches).toHaveLength(0);
  });
});

describe('createBranch', () => {
  it('saves messages from forkAt onwards as a branch', () => {
    const { branch } = createBranch(SESSION, 2, emptyBranchState());
    expect(branch.forkAt).toBe(2);
    expect(branch.messages).toEqual(SESSION.slice(2));
    expect(branch.id).toBeTruthy();
  });

  it('appends to existing branches', () => {
    let state = emptyBranchState();
    const r1 = createBranch(SESSION, 2, state);
    const r2 = createBranch(SESSION, 2, r1.updated);
    expect(r2.updated.branches).toHaveLength(2);
  });

  it('stays on trunk (activeIndex=-1) after fork', () => {
    const { updated } = createBranch(SESSION, 2, emptyBranchState());
    const nav = updated.forkNav.find(n => n.forkAt === 2);
    expect(nav?.activeIndex).toBe(-1);
  });

  it('preserves branch messages immutably', () => {
    const { branch } = createBranch(SESSION, 0, emptyBranchState());
    expect(branch.messages).toEqual(SESSION);
    // verify it is a copy, not a reference to original
    expect(branch.messages).not.toBe(SESSION);
  });

  it('createdAt is a positive number', () => {
    const { branch } = createBranch(SESSION, 0, emptyBranchState());
    expect(branch.createdAt).toBeGreaterThan(0);
  });
});

describe('siblingCount', () => {
  it('returns 1 when no branches at that fork', () => {
    expect(siblingCount(2, emptyBranchState())).toBe(1);
  });

  it('counts trunk + branches', () => {
    let state = emptyBranchState();
    state = createBranch(SESSION, 2, state).updated;
    state = createBranch(SESSION, 2, state).updated;
    expect(siblingCount(2, state)).toBe(3); // trunk + 2 branches
  });

  it('does not count branches at a different fork point', () => {
    let state = emptyBranchState();
    state = createBranch(SESSION, 1, state).updated;
    expect(siblingCount(2, state)).toBe(1);
  });
});

describe('getForkPoints', () => {
  it('returns empty array when no branches', () => {
    expect(getForkPoints(emptyBranchState())).toEqual([]);
  });

  it('returns sorted unique fork points', () => {
    let state = emptyBranchState();
    state = createBranch(SESSION, 2, state).updated;
    state = createBranch(SESSION, 0, state).updated;
    state = createBranch(SESSION, 2, state).updated;
    expect(getForkPoints(state)).toEqual([0, 2]);
  });
});

describe('getForkInfo', () => {
  it('returns current=-1 (trunk) and total when no branches', () => {
    const info = getForkInfo(2, emptyBranchState());
    expect(info.current).toBe(-1);
    expect(info.total).toBe(1);
  });

  it('shows total including branches', () => {
    let state = emptyBranchState();
    state = createBranch(SESSION, 2, state).updated;
    const info = getForkInfo(2, state);
    expect(info.total).toBe(2);
    expect(info.current).toBe(-1);
  });
});

describe('navigateBranch', () => {
  const trunk: Message[] = [
    msg('user', 'Hello'),
    msg('assistant', 'Hi'),
    msg('user', 'Original question'),
    msg('assistant', 'Original answer'),
  ];

  it('navigates forward from trunk to first branch', () => {
    const altTail: Message[] = [msg('user', 'Edited question'), msg('assistant', 'Alt answer')];
    let state: BranchState = {
      branches: [{ id: 'b1', forkAt: 2, messages: altTail, createdAt: 1 }],
      forkNav: [],
    };
    const { messages, updated } = navigateBranch(trunk, state, 2, 1);
    // prefix [0..1] + altTail
    expect(messages[0].content).toBe('Hello');
    expect(messages[1].content).toBe('Hi');
    expect(messages[2].content).toBe('Edited question');
    expect(messages[3].content).toBe('Alt answer');
    const nav = updated.forkNav.find(n => n.forkAt === 2);
    expect(nav?.activeIndex).toBe(0); // first branch
  });

  it('wraps from branch back to trunk', () => {
    let state: BranchState = {
      branches: [{ id: 'b1', forkAt: 2, messages: [msg('user', 'Alt')], createdAt: 1 }],
      forkNav: [{ forkAt: 2, activeIndex: 0 }], // currently on branch 0
    };
    const { messages, updated } = navigateBranch(trunk, state, 2, 1);
    // should wrap back to trunk
    expect(messages[2].content).toBe('Original question');
    const nav = updated.forkNav.find(n => n.forkAt === 2);
    expect(nav?.activeIndex).toBe(-1);
  });

  it('navigates backward from trunk wraps to last branch', () => {
    const alt1: Message[] = [msg('user', 'Alt1')];
    const alt2: Message[] = [msg('user', 'Alt2')];
    let state: BranchState = {
      branches: [
        { id: 'b1', forkAt: 2, messages: alt1, createdAt: 1 },
        { id: 'b2', forkAt: 2, messages: alt2, createdAt: 2 },
      ],
      forkNav: [{ forkAt: 2, activeIndex: -1 }], // on trunk
    };
    const { messages, updated } = navigateBranch(trunk, state, 2, -1);
    // should wrap to last branch (index 1)
    expect(messages[2].content).toBe('Alt2');
    const nav = updated.forkNav.find(n => n.forkAt === 2);
    expect(nav?.activeIndex).toBe(1);
  });

  it('preserves messages before fork point', () => {
    const altTail = [msg('user', 'Edited')];
    let state: BranchState = {
      branches: [{ id: 'b1', forkAt: 2, messages: altTail, createdAt: 1 }],
      forkNav: [],
    };
    const { messages } = navigateBranch(trunk, state, 2, 1);
    expect(messages.slice(0, 2)).toEqual(trunk.slice(0, 2));
  });

  it('round-trips: navigate forward twice returns to trunk with 2 branches', () => {
    const alt1 = [msg('user', 'Alt1')];
    const alt2 = [msg('user', 'Alt2')];
    let state: BranchState = {
      branches: [
        { id: 'b1', forkAt: 2, messages: alt1, createdAt: 1 },
        { id: 'b2', forkAt: 2, messages: alt2, createdAt: 2 },
      ],
      forkNav: [],
    };
    // trunk → branch0
    const r1 = navigateBranch(trunk, state, 2, 1);
    expect(r1.messages[2].content).toBe('Alt1');
    // branch0 → branch1
    const r2 = navigateBranch(trunk, r1.updated, 2, 1);
    expect(r2.messages[2].content).toBe('Alt2');
    // branch1 → trunk (wrap)
    const r3 = navigateBranch(trunk, r2.updated, 2, 1);
    expect(r3.messages[2].content).toBe('Original question');
    const nav = r3.updated.forkNav.find(n => n.forkAt === 2);
    expect(nav?.activeIndex).toBe(-1);
  });
});

describe('branching integration: edit workflow', () => {
  it('edit mid-conversation creates sibling, original retained as branch', () => {
    // Simulate: user had conversation [u0, a0, u1, a1]
    // User edits u1 (index 2) → fork at 2, save [u1, a1] as branch
    const messages = [...SESSION];
    let state = emptyBranchState();

    // Step 1: fork at index 2 (before editing)
    const { branch, updated } = createBranch(messages, 2, state);
    state = updated;

    // Original tail is saved
    expect(branch.messages).toEqual(SESSION.slice(2));

    // Step 2: truncate trunk and append new user message
    const newTrunk: Message[] = [
      ...messages.slice(0, 2),
      msg('user', 'Tell me about dogs'),
    ];

    // Step 3: there should be 1 fork point at index 2
    expect(getForkPoints(state)).toContain(2);
    expect(siblingCount(2, state)).toBe(2);

    // Step 4: navigate backward shows the original branch
    const { messages: branchView } = navigateBranch(newTrunk, state, 2, -1);
    expect(branchView[2].content).toBe('Tell me about cats');
  });
});

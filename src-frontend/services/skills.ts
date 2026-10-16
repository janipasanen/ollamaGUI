/**
 * Skills & self-learning (#670).
 *
 * A *skill* is a reusable, human-readable piece of methodology the agent can
 * consult — "how to do X", "how this project's tools should be used", "how to
 * fix Y". Skills are:
 *
 *  - Stored in localStorage (`ollama_gui_skills`).
 *  - Scoped `global` (everywhere) or `local` (only inside a project, by id).
 *  - Surfaceable as a system-prompt block so the model knows they exist and
 *    can follow them.
 *
 * Self-learning records tool sequences an agent successfully ran and, when it
 * recognises a reusable pattern, *creates a skill* automatically so the
 * behaviour is available next time. Skills can also be authored manually or
 * imported.
 *
 * Design goals: keep the "did this sequence count as a learnable skill"
 * logic pure + deterministic (no LLM call required) so it is unit-testable.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type SkillSource = 'manual' | 'auto' | 'import';
export type SkillScope = 'global' | 'local';

export interface Skill {
  id: string;
  title: string;
  /** One-line summary shown in skill lists. */
  description: string;
  /** The actual methodology / steps. */
  content: string;
  tags: string[];
  /** 'global' = every project; 'local' = only projectId. */
  scope: SkillScope;
  projectId?: string;
  source: SkillSource;
  /** How many times this skill was composed into a prompt. */
  usageCount: number;
  lastUsedAt?: number;
  createdAt: number;
  updatedAt: number;
}

// ── Persistence ──────────────────────────────────────────────────────────────

const SKILLS_KEY = 'ollama_gui_skills';
const RECENT_SEQ_KEY = 'ollama_gui_recent_tool_sequences';

export function loadSkills(): Skill[] {
  try { return JSON.parse(localStorage.getItem(SKILLS_KEY) ?? '[]') as Skill[]; } catch { return []; }
}

export function saveSkills(skills: Skill[]): void {
  try { localStorage.setItem(SKILLS_KEY, JSON.stringify(skills)); } catch { /* quota */ }
}

export function addSkill(skill: Omit<Skill, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'>): Skill {
  const now = Date.now();
  const entry: Skill = { ...skill, id: crypto.randomUUID(), usageCount: 0, createdAt: now, updatedAt: now };
  saveSkills([...loadSkills(), entry]);
  return entry;
}

export function updateSkill(id: string, patch: Partial<Omit<Skill, 'id' | 'createdAt'>>): Skill | null {
  const all = loadSkills();
  const idx = all.findIndex(s => s.id === id);
  if (idx === -1) return null;
  const updated: Skill = { ...all[idx], ...patch, id, createdAt: all[idx].createdAt, updatedAt: Date.now() };
  all[idx] = updated;
  saveSkills(all);
  return updated;
}

export function removeSkill(id: string): boolean {
  const all = loadSkills();
  const next = all.filter(s => s.id !== id);
  if (next.length === all.length) return false;
  saveSkills(next);
  return true;
}

// ── Relevance ─────────────────────────────────────────────────────────────────

function matchScore(query: string, s: Skill): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  let score = 0;
  const haystacks = [s.title, s.description, s.content, s.tags.join(' ')];
  for (const h of haystacks) {
    const hay = h.toLowerCase();
    // whole-phrase hit is worth more than any token hit
    if (hay.includes(q)) score += 3;
    for (const token of q.split(/\s+/).filter(Boolean)) {
      if (hay.includes(token)) score += 1;
    }
  }
  return score;
}

/**
 * Skills relevant to `query` inside `projectId` (global + project-local).
 * Ranked by relevance score, then usage, then recency. `limit` bounds the set.
 */
export function getRelevantSkills(query: string, projectId?: string, limit = 8): Skill[] {
  return loadSkills()
    .filter(s => s.scope === 'global' || (projectId && s.scope === 'local' && s.projectId === projectId))
    .map(s => ({ s, score: matchScore(query, s) }))
    .filter(x => limit === 0 || x.score > 0 || query === '')
    .sort((a, b) =>
      b.score - a.score
      || (b.s.usageCount ?? 0) - (a.s.usageCount ?? 0)
      || (b.s.lastUsedAt ?? 0) - (a.s.lastUsedAt ?? 0)
      || b.s.createdAt - a.s.createdAt,
    )
    .map(({ s }) => s)
    .slice(0, limit);
}

// ── Usage tracking ─────────────────────────────────────────────────────────────

/** Mark a skill as used (used in composeSkillBlock so the model knows). */
export function recordUsage(skillId: string): void {
  const all = loadSkills();
  const idx = all.findIndex(s => s.id === skillId);
  if (idx === -1) return;
  all[idx] = { ...all[idx], usageCount: (all[idx].usageCount ?? 0) + 1, lastUsedAt: Date.now() };
  saveSkills(all);
}

// ── System prompt composition ──────────────────────────────────────────────────

/**
 * Compose the top skills into a system-prompt block.
 *
 * Lists a short `[title] — description` index for every matching skill, then
 * includes the full `content` of the single most relevant skill (to stay within
 * `maxChars`). The block teaches the model the skills exist and how to follow
 * the best match.
 */
export function composeSkillBlock(query: string, projectId?: string, maxChars = 1500): string {
  const skills = getRelevantSkills(query, projectId, 8);
  if (skills.length === 0) return '';

  const header = `--- Skills ---\nUseful techniques and project-specific how-to's:\n`;
  let index = header;
  let used = index.length;
  const indexOnly: Skill[] = [];
  for (const s of skills) {
    const line = `- [${s.title.trim()}] ${s.description.trim()}\n`;
    if (used + line.length > maxChars) {
      indexOnly.push(s);
      continue;
    }
    index += line;
    used += line.length;
  }
  if (index.length === header.length) return ''; // nothing in the index
  index += '---\n';
  used += '---\n'.length;

  // Include full content for the single best match that fits the budget.
  let block = index;
  const top = skills[0];
  const detail = `${top.title.trim()}\n${top.content.trim()}\n`;
  if (used + detail.length <= maxChars) {
    block += `\n${detail}---\n`;
  }
  return block;
}

// ── Recent tool-sequence log (self-learning feed) ─────────────────────────────

interface ToolSequence {
  prompt: string;
  tools: string[];
  success: boolean;
  ts: number;
}

function loadSequences(): ToolSequence[] {
  try { return JSON.parse(localStorage.getItem(RECENT_SEQ_KEY) ?? '[]') as ToolSequence[]; } catch { return []; }
}

function saveSequences(sequences: ToolSequence[]): void {
  try { localStorage.setItem(RECENT_SEQ_KEY, JSON.stringify(sequences.slice(0, 50))); } catch { /* quota */ }
}

/** Record a completed agentic run's tool sequence (called by the UI). */
export function recordToolSequence(prompt: string, tools: string[], success: boolean): void {
  if (!prompt.trim()) return;
  const sequences = loadSequences();
  sequences.push({ prompt: prompt.trim(), tools, success, ts: Date.now() });
  saveSequences(sequences);
}

// ── Self-learning: capture a skill from a tool sequence ───────────────────────

const TOOL_REGISTRY: { [name: string]: string } = {};

/** Test seam: register tool descriptions so captured skills can describe usage. */
export function _registerToolDescription(name: string, description: string): void {
  TOOL_REGISTRY[name] = description;
}

/** Forget a tool description (test cleanup). */
export function _unregisterToolDescription(name: string): void {
  delete TOOL_REGISTRY[name];
}

/**
 * Turn a successful tool sequence into a candidate skill.
 *
 * Deterministic so it is unit-testable: the title is derived from the leading
 * words of the prompt, and the content describes the trigger + the ordered
 * tool usage (with descriptions) so the model — or a human reviewer — learns
 * how those tools should be used.
 */
export function autoCaptureSkill(opts: {
  prompt: string;
  tools: string[];
  projectId?: string;
  scope?: SkillScope;
}): Skill | null {
  const prompt = opts.prompt.trim();
  // Need both a prompt and at least two distinct tools to be "learnable".
  if (!prompt) return null;
  const tools = [...new Set(opts.tools)].filter(Boolean);
  if (tools.length < 2) return null;

  const title = deriveTitle(prompt, tools);

  // Don't recreate a captured skill if one already covers this trigger.
  const existing = loadSkills().find(s => s.title === title && sameToolSet(s, tools));
  if (existing) {
    recordUsage(existing.id);
    return existing;
  }

  const description = `Auto-captured workflow: ${tools.join(' → ')}`;
  const content = [
    `Triggered by: "${prompt}"`,
    '',
    'Tools used, in order:',
    ...tools.map((t, i) => `${i + 1}. ${t}` + (TOOL_REGISTRY[t] ? ` — ${TOOL_REGISTRY[t]}` : '')),
    '',
    'How these tools should be used:',
    ...tools.map((t, i) => {
      const desc = TOOL_REGISTRY[t] || `${t}`;
      return `  • ${t} ${desc}`;
    }),
    '',
    `Recommended: run ${tools[0]} first, then use the result to drive ${tools.slice(1).join(', ')}.`,
  ].join('\n');

  const tags = [...extractTags(prompt), 'auto-workflow', ...tools.slice(0, 2)];
  return addSkill({
    title,
    description,
    content,
    tags,
    scope: opts.scope ?? 'global',
    projectId: opts.scope === 'local' ? opts.projectId : undefined,
    source: 'auto',
  });
}

function deriveTitle(prompt: string, tools: string[]): string {
  // Build a short imperative-ish title from the leading words of the prompt.
  const words = prompt.trim().toLowerCase().split(/\s+/).slice(0, 4).join(' ');
  const head = words
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
  const base = head ? head : tools.join('-');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function sameToolSet(s: Skill, tools: string[]): boolean {
  const a = [...(s.tags ?? [])].filter(t => tools.includes(t));
  return a.length > 0;
}

function extractTags(prompt: string): string[] {
  const common = new Set(['do', 'to', 'for', 'of', 'the', 'with', 'and', 'or', 'how', 'when', 'a', 'an', 'in']);
  return prompt
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length > 3 && !common.has(w))
    .slice(0, 3);
}

// ── Agent tool wiring ──────────────────────────────────────────────────────────

import { toolRegistry, type ToolDefinition } from './tools';

/**
 * Register the self-learning skill tools so the model can author/list skills.
 * Call during app init (parity with registerMemoryTools()).
 */
export function registerSkillsTools(): void {
  // learn_skill — create or update a skill.
  toolRegistry.registerTool({
    name: 'learn_skill',
    description: 'Author or revise a reusable skill (a "how to" procedure). The model calls this when it works out a repeatable way to do something, or when the user asks it to learn something.',
    readOnly: false,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title, e.g. "Review a merge request"' },
        description: { type: 'string', description: 'One-line summary of what the skill does' },
        content: { type: 'string', description: 'The methodology / ordered steps to follow' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags to improve retrieval' },
      },
      required: ['title', 'description', 'content'],
    },
    execute: async (p) => {
      const skill = addSkill({
        title: String(p.title ?? 'Untitled skill'),
        description: String(p.description ?? ''),
        content: String(p.content ?? ''),
        tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
        scope: 'global',
        source: 'manual',
      });
      return { id: skill.id, saved: true, title: skill.title };
    },
  });

  // list_skills — retrieve relevant skills by query.
  toolRegistry.registerTool({
    name: 'list_skills',
    description: 'List the skills relevant to the current task. Call at the start of a task to see if a relevant procedure already exists.',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you are trying to do (used to match skills). Optional.' },
        limit: { type: 'number', description: 'Max skills to return (default 6).' },
      },
    },
    execute: async (p) => {
      const limit = typeof p.limit === 'number' ? p.limit : 6;
      const skills = getRelevantSkills(String(p.query ?? ''), undefined, limit);
      return { skills: skills.map(s => ({ title: s.title, description: s.description, tags: s.tags })) };
    },
  });

  // note_skill — quick "remember how to do X" from free-form text.
  toolRegistry.registerTool({
    name: 'note_skill',
    description: 'Save a free-form skill note. Use when the user says "remember how to X" or "learn X".',
    readOnly: false,
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'The skill to remember, e.g. "To hotfix the build, run make test then make build"' },
        title: { type: 'string', description: 'Optional short title (defaults to a summary of the note).' },
      },
      required: ['note'],
    },
    execute: async (p) => {
      const note = String(p.note ?? '').trim();
      if (!note) return { saved: false };
      const title = String(p.title ?? note).slice(0, 60);
      const skill = addSkill({
        title,
        description: note.slice(0, 120),
        content: note,
        tags: extractTags(note),
        scope: 'global',
        source: 'manual',
      });
      return { id: skill.id, saved: true, title: skill.title };
    },
  });
}

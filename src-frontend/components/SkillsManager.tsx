/**
 * Skills manager UI (#670).
 *
 * A compact, self-contained panel for browsing / creating / editing / deleting
 * the agent's skills. Renders inside the app (currently the Settings overlay).
 * All persistence goes through the `skills` service, so this component has no
 * opinion about storage.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  loadSkills, addSkill, updateSkill, removeSkill,
  type Skill,
} from '../services/skills';

export function SkillsManager({ projectId }: { projectId?: string }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'auto' | 'manual'>('all');
  const [editId, setEditId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ title: '', description: '', content: '', tags: '' });

  // Reload after any mutation.
  const refresh = () => setSkills(loadSkills());
  useEffect(() => { refresh(); }, []);

  const visible = useMemo(() => {
    const all = skills.filter(s => (filter === 'all' ? true : s.source === filter));
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter(s =>
      s.title.toLowerCase().includes(q)
      || s.description.toLowerCase().includes(q)
      || s.content.toLowerCase().includes(q)
      || s.tags.some(t => t.toLowerCase().includes(q)),
    );
  }, [skills, filter, query]);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    addSkill({
      title: draft.title.trim(),
      description: draft.description.trim(),
      content: draft.content.trim(),
      tags: draft.tags.split(',').map(t => t.trim()).filter(Boolean),
      scope: projectId ? 'local' : 'global',
      ...(projectId ? { projectId } : {}),
      source: 'manual',
    });
    setDraft({ title: '', description: '', content: '', tags: '' });
    setShowAdd(false);
    refresh();
  }

  const autoCount = skills.filter(s => s.source === 'auto').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search skills…"
          className={`flex-1 min-w-[12rem] border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none ${
            darkBg() ? 'bg-zinc-900 border-zinc-700 text-zinc-100' : 'bg-zinc-100 border-zinc-300 text-zinc-900'
          }`}
        />
        <button
          onClick={() => { setFilter(f => f === 'all' ? 'auto' : f === 'auto' ? 'manual' : 'all'); }}
          className="text-xs px-3 py-1.5 rounded-lg border transition-colors hover:bg-zinc-700/50"
          title="Cycle filter: all → auto → manual"
        >
          {filter === 'all' ? 'All' : filter === 'auto' ? 'Auto only' : 'Manual only'}
        </button>
        <button
          onClick={() => { setShowAdd(s => !s); setEditId(null); }}
          className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500"
        >
          + Add skill
        </button>
      </div>

      {autoCount > 0 && (
        <p className={`text-[10px] ${darkBg() ? 'text-zinc-500' : 'text-zinc-400'}`}>
          {autoCount} auto-captured · {skills.length - autoCount} manual · {skills.length} total
        </p>
      )}

      {showAdd && (
        <form onSubmit={handleAdd} className={`border rounded-xl p-3 space-y-2 ${darkBg() ? 'border-zinc-700' : 'border-zinc-300'}`}>
          <input
            value={draft.title}
            onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
            placeholder="Title (required)"
            className={`w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${darkBg() ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-100 border-zinc-300'}`}
          />
          <input
            value={draft.description}
            onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
            placeholder="One-line summary"
            className={`w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${darkBg() ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-100 border-zinc-300'}`}
          />
          <textarea
            value={draft.content}
            onChange={e => setDraft(d => ({ ...d, content: e.target.value }))}
            placeholder="The methodology / ordered steps to follow"
            rows={4}
            className={`w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-y ${darkBg() ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-100 border-zinc-300'}`}
          />
          <input
            value={draft.tags}
            onChange={e => setDraft(d => ({ ...d, tags: e.target.value }))}
            placeholder="Tags (comma separated)"
            className={`w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${darkBg() ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-100 border-zinc-300'}`}
          />
          <div className="flex gap-2">
            <button type="submit" className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500">Save</button>
            <button type="button" onClick={() => { setShowAdd(false); setDraft({ title: '', description: '', content: '', tags: '' }); }} className="text-xs px-3 py-1.5 rounded-lg border hover:bg-zinc-700/50">Cancel</button>
          </div>
        </form>
      )}

      <ul className="space-y-2">
        {visible.map(s => (
          <SkillRow
            key={s.id}
            skill={s}
            isEditing={editId === s.id}
            onEdit={() => setEditId(s.id)}
            onCancel={() => setEditId(null)}
            onDelete={() => { removeSkill(s.id); refresh(); }}
            onSave={(patch) => { updateSkill(s.id, patch); refresh(); }}
          />
        ))}
        {visible.length === 0 && (
          <p className={`text-xs ${darkBg() ? 'text-zinc-500' : 'text-zinc-400'}`}>No skills. Add one or let the harness capture them automatically.</p>
        )}
      </ul>
    </div>
  );
}

function SkillRow({ skill, isEditing, onEdit, onCancel, onDelete, onSave }: {
  skill: Skill;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onSave: (patch: Partial<Pick<Skill, 'title' | 'description' | 'content' | 'tags'>>) => void;
}) {
  const [title, setTitle] = useState(skill.title);
  const [description, setDescription] = useState(skill.description);
  const [content, setContent] = useState(skill.content);
  const [tags, setTags] = useState(skill.tags.join(', '));

  useEffect(() => { setTitle(skill.title); setDescription(skill.description); setContent(skill.content); setTags(skill.tags.join(', ')); }, [skill]);

  const dark = darkBg();

  if (isEditing) {
    return (
      <li className={`border rounded-xl p-3 space-y-2 ${dark ? 'border-zinc-700' : 'border-zinc-300'}`}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title"
          className={`w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-100 border-zinc-300'}`} />
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Summary"
          className={`w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-100 border-zinc-300'}`} />
        <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Steps" rows={4}
          className={`w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-y ${dark ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-100 border-zinc-300'}`} />
        <input value={tags} onChange={e => setTags(e.target.value)} placeholder="Tags (comma separated)"
          className={`w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${dark ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-100 border-zinc-300'}`} />
        <div className="flex gap-2">
          <button onClick={() => { onSave({ title: title.trim(), description: description.trim(), content, tags: tags.split(',').map(t => t.trim()).filter(Boolean) }); }}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500">Save</button>
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg border hover:bg-zinc-700/50">Cancel</button>
        </div>
      </li>
    );
  }

  return (
    <li className={`border rounded-xl p-3 ${dark ? 'border-zinc-700' : 'border-zinc-300'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm truncate">{skill.title}</p>
            <span className={`text-[9px] px-1.5 py-0.5 rounded capitalize ${skill.source === 'auto'
              ? (dark ? 'bg-purple-900/40 text-purple-200' : 'bg-purple-100 text-purple-700')
              : (dark ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-200 text-zinc-700')}`}>{skill.source}</span>
          </div>
          {skill.description && <p className={`text-xs mt-0.5 ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>{skill.description}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} className={`text-[10px] px-2 py-1 rounded border hover:bg-zinc-700/50 ${dark ? 'border-zinc-600 text-zinc-300' : 'border-zinc-300 text-zinc-600'}`}>Edit</button>
          <button onClick={onDelete} className="text-[10px] px-2 py-1 rounded border border-red-700/50 text-red-500 hover:bg-red-950/40">Del</button>
        </div>
      </div>
      <div className="mt-2 text-xs whitespace-pre-wrap break-words dark:text-zinc-300"
        style={dark ? { color: '#d4d4d4' } : { color: '#3f3f46' }}>
        {skill.content}
      </div>
      {skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {skill.tags.map(t => (
            <span key={t} className={`text-[9px] px-1.5 py-0.5 rounded ${dark ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-100 text-zinc-500'}`}>{t}</span>
          ))}
        </div>
      )}
      {(skill.usageCount ?? 0) > 0 && <p className={`text-[9px] mt-1 ${dark ? 'text-zinc-600' : 'text-zinc-400'}`}>used {(skill.usageCount ?? 0)}×</p>}
    </li>
  );
}

// Local dark-mode probe so this standalone component matches the app theme
// without threading theme state through.
function darkBg(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

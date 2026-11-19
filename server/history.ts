// local addition: the Director's past conversations, read from Claude Code's own transcripts
// (~/.claude/projects/<folder with every non-letter/digit as "-">/<session id>.jsonl). The crew folder's ones can be
// resumed in the terminal (claude --resume <id> runs there). Only this Director's: each channel keeps its own history.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { crewDir } from './crew.js';
import { config, saveConfig } from './config.js';
import { DATA_DIR } from './util.js';

const PROJECTS = () => process.env.VIDEOHUB_CLAUDE_PROJECTS || path.join(os.homedir(), '.claude', 'projects');
export const transcriptsOf = dir => path.join(PROJECTS(), String(dir).replace(/[^A-Za-z0-9]/g, '-'));
const ID = /^[0-9a-f-]{36}$/i;
const lines = f => fs.readFileSync(f, 'utf8').split('\n').flatMap(l => { try { return l ? [JSON.parse(l)] : []; } catch { return []; } });

// one transcript line → what the page shows: your words, Claude's words, or the name of a step it took
export function toItems(m) {
  const at = m.timestamp || null, c = m.message?.content;
  if (m.isMeta || m.isSidechain) return [];
  if (m.type === 'user') {
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('\n') : '';
    return text.trim() && !text.trim().startsWith('<') ? [{ role: 'you', text: text.trim(), at }] : [];
  }
  if (m.type === 'assistant' && Array.isArray(c)) return c.flatMap(b => b.type === 'text' && b.text.trim() ? [{ role: 'claude', text: b.text.trim(), at }]
    : b.type === 'tool_use' ? [{ role: 'step', text: b.name === 'Agent' || b.name === 'Task' ? `Briefed ${b.input?.subagent_type || 'an agent'}: ${b.input?.description || ''}` : b.name.replace(/^mcp__\w+__/, ''), at }] : []);
  return [];
}

// archived: hidden from History (VideoHub's settings keep the ids), still there to read, open or bring back
const archivedIds = () => new Set(Array.isArray(config().archivedChats) ? config().archivedChats : []);
export function list(limit = 50, { archived = false }: { archived?: any } = {}) {
  const hidden = archivedIds();
  const out = [];
  for (const [dir, resumable] of [[crewDir(), true]]) {
    const folder = transcriptsOf(dir); let names = [];
    try { names = fs.readdirSync(folder).filter(n => n.endsWith('.jsonl')); } catch { }
    for (const n of names) {
      const f = path.join(folder, n), st = fs.statSync(f);
      const items = lines(f).flatMap(toItems), first = items.find(i => i.role === 'you');
      if (!first) continue;   // no message of yours: nothing to show
      if (hidden.has(n.slice(0, -6)) !== archived) continue;
      out.push({ id: n.slice(0, -6), title: first.text.replace(/\s+/g, ' ').slice(0, 90), messages: items.filter(i => i.role === 'you').length, updated: st.mtimeMs, resumable });
    }
  }
  return out.sort((a, b) => b.updated - a.updated).slice(0, limit);
}
export function read(id) {
  if (!ID.test(String(id))) throw Object.assign(new Error('bad conversation id'), { code: 400 });
  for (const [dir, resumable] of [[crewDir(), true]]) {
    const f = path.join(transcriptsOf(dir), id + '.jsonl');
    if (fs.existsSync(f)) return { id, resumable, items: lines(f).flatMap(toItems).slice(-600) };
  }
  throw Object.assign(new Error('Conversation not found'), { code: 404 });
}

const fileOf = id => {
  if (!ID.test(String(id))) throw Object.assign(new Error('bad conversation id'), { code: 400 });
  const f = path.join(transcriptsOf(crewDir()), id + '.jsonl');
  if (!fs.existsSync(f)) throw Object.assign(new Error('Conversation not found'), { code: 404 });
  return f;
};
export function archive({ id, on = true }: { id?: string; on?: boolean } = {}) {
  fileOf(id); const ids = archivedIds(); on ? ids.add(id) : ids.delete(id);
  saveConfig({ archivedChats: [...ids] }); return { id, archived: !!on };
}
// delete: the transcript (and its agents' folder) moves to VideoHub's trash folder, out of Claude Code's reach;
// to bring it back, move it back to the folder named in trash/conversations/<id>.from.txt
export function remove({ id }: { id?: string } = {}) {
  const f = fileOf(id), trash = path.join(DATA_DIR, 'trash', 'conversations'); fs.mkdirSync(trash, { recursive: true });
  const move = (from, to) => { try { fs.renameSync(from, to); } catch { fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true, force: true }); } };
  move(f, path.join(trash, id + '.jsonl'));
  const sub = f.slice(0, -6); if (fs.existsSync(sub)) move(sub, path.join(trash, id));
  fs.writeFileSync(path.join(trash, id + '.from.txt'), path.dirname(f));
  const ids = archivedIds(); if (ids.delete(id)) saveConfig({ archivedChats: [...ids] });
  return { id, deleted: true };
}

// the conversation that launched a film: the oldest of this crew's transcripts naming its folder under films\
// (paths sit JSON-escaped in the .jsonl, so backslashes are folded to "/" before matching)
export function ofFilm(folder) {
  const name = path.basename(String(folder || '').replace(/[\\/]+$/, ''));
  if (!name || name === '.' || name === '..') throw Object.assign(new Error('no film folder'), { code: 400 });
  const re = new RegExp('films/' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w.-])', 'i');
  const dir = transcriptsOf(crewDir()); let names = [];
  try { names = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl')); } catch { }
  const born = n => { const st = fs.statSync(path.join(dir, n)); return st.birthtimeMs || st.mtimeMs; };
  for (const n of names.sort((a, b) => born(a) - born(b)))
    if (re.test(fs.readFileSync(path.join(dir, n), 'utf8').replace(/\\+/g, '/'))) return { id: n.slice(0, -6) };
  return { id: null };
}

export function routes(route) {
  route('GET', '/api/crew/film-conversation', (req, url) => ofFilm(url.searchParams.get('path')));
  route('GET', '/api/crew/history', (req, url) => list(50, { archived: url?.searchParams?.get('archived') === '1' }));
  route('GET', '/api/crew/history/:id', (req, url, { id }) => read(id));
}

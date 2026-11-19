// local addition: what a Director conversation and each of its crew agents used, read from Claude Code's own
// conversation logs (<transcripts of the crew folder>/<id>.jsonl and <id>/subagents/agent-*.jsonl). Works the same for
// the chat Director and the terminal Director (which reports nothing to VideoHub while it runs). Estimates at API list
// prices, not a bill: on a Claude plan this is how much of the limit was used.
import fs from 'node:fs';
import path from 'node:path';
import { transcriptsOf } from './history.js';

// $ per million tokens (Claude API list prices, 2026-11). Cache writes: 1.25× input for 5 minutes, 2× for 1 hour.
// shortcut: a fixed table, update it when prices change (a model not listed shows its tokens without $)
export const PRICES = {
  opus: { in: 4, out: 20, read: 0.2 }, sonnet: { in: 2, out: 10, read: 0.1 },
  haiku: { in: 0.1, out: 0.5, read: 0.01 }, fable: { in: 8, out: 40, read: 0.2 },
};
const family = model => (/claude-([a-z]+)/.exec(String(model)) || [])[1];
// tokens by kind, the estimated cost, and the same per model family (opus, sonnet…)
export type Totals = { fresh: number; cacheWrite: number; cacheRead: number; output: number; cost: number; priced: boolean;
  models: Record<string, { tokens: number; cost: number }>; calls?: number; codeMode?: boolean };
// one crew agent run, as Claude Code records it in agent-<id>.meta.json
export type AgentMeta = { agentId: string; toolUseId: string; agentType?: string; description?: string; finished?: boolean; mtime: number };
const empty = (): Totals => ({ fresh: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0, priced: true, models: {} });
function add(t, u, model) {
  const write = u.cache_creation_input_tokens || 0, long = u.cache_creation?.ephemeral_1h_input_tokens || 0, short = write - long;
  const c = { fresh: u.input_tokens || 0, cacheWrite: write, cacheRead: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 };
  for (const k of Object.keys(c)) t[k] += c[k];
  const p = PRICES[family(model)];
  const cost = p ? (c.fresh * p.in + short * p.in * 1.25 + long * p.in * 2 + c.cacheRead * p.read + c.output * p.out) / 1e6 : 0;
  if (!p) t.priced = false;
  t.cost += cost;
  const m = t.models[family(model) || String(model)] ||= { tokens: 0, cost: 0 };
  m.tokens += c.fresh + c.cacheWrite + c.cacheRead + c.output; m.cost += cost;
}
// one log file → its totals; each API response counted once (parallel tool calls repeat the same message id)
export function totalsOf(file) {
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const t = empty(), seen = new Set(); let codeMode = false;
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type !== 'assistant' || !m.message?.usage) continue;
    if (Array.isArray(m.message.content) && m.message.content.some(b => b.type === 'tool_use' && b.name === 'REPL')) codeMode = true;   // Code Mode runs its code through the REPL tool
    if (seen.has(m.message.id)) continue; seen.add(m.message.id);
    add(t, m.message.usage, m.message.model);
  }
  return { ...t, calls: seen.size, codeMode };
}
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
// Claude Code's own record of each crew agent of a conversation (agent-<id>.meta.json): the Director's call that
// launched it (toolUseId), its type and whether it finished. VideoHub checks its "working" agents against it.
export function agentMetas({ cwd, session }: { cwd: string; session?: string }): AgentMeta[] {
  if (!/^[0-9a-f-]{36}$/i.test(String(session))) return [];
  const subs = path.join(transcriptsOf(cwd), session, 'subagents');
  let files = []; try { files = fs.readdirSync(subs).filter(f => /^agent-\w+\.meta\.json$/.test(f)); } catch { return []; }
  const at = f => { try { return fs.statSync(path.join(subs, f)).mtimeMs; } catch { return 0; } };
  return files.map(f => ({ agentId: f.slice(6, -10), ...readJson(path.join(subs, f)), mtime: at(f) })).filter(m => m.toolUseId);
}
const bad = (msg, code) => Object.assign(new Error(msg), { code });
// a conversation: the Director's own work, each crew agent run and the sum; or one agent run (agent = its id).
// No session id: the most recent conversation of the folder.
export function usage({ cwd, session, agent }: { cwd: string; session?: string; agent?: string }) {
  const dir = transcriptsOf(cwd);
  if (!session) { try { session = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f.slice(0, -6); } catch { } }
  if (!session) throw bad('No conversation yet', 404);
  if (!/^[0-9a-f-]{36}$/i.test(session)) throw bad('Bad conversation id', 400);
  if (agent && !/^\w{1,64}$/.test(agent)) throw bad('Bad agent id', 400);
  const subs = path.join(dir, session, 'subagents');
  const agentRow = id => { const t = totalsOf(path.join(subs, `agent-${id}.jsonl`)); if (!t) return null; const meta = readJson(path.join(subs, `agent-${id}.meta.json`)); return { id, agent: meta.agentType || 'crew agent', description: meta.description || '', ...t }; };
  if (agent) return agentRow(agent) || (() => { throw bad('That agent has no log yet', 404); })();
  const director = totalsOf(path.join(dir, session + '.jsonl'));
  if (!director) throw bad('No log for this conversation', 404);
  let ids = []; try { ids = fs.readdirSync(subs).filter(f => /^agent-\w+\.jsonl$/.test(f)).map(f => f.slice(6, -6)); } catch { }
  const agents = ids.map(agentRow).filter(Boolean);
  const total = empty(); total.codeMode = director.codeMode || agents.some(a => a.codeMode);
  for (const r of [director, ...agents]) {
    for (const k of ['fresh', 'cacheWrite', 'cacheRead', 'output', 'cost']) total[k] += r[k];
    if (!r.priced) total.priced = false;
    for (const [m, v] of Object.entries(r.models)) { const x = total.models[m] ||= { tokens: 0, cost: 0 }; x.tokens += v.tokens; x.cost += v.cost; }
  }
  return { session, director, agents, total };
}

// local addition: the Director as a chat, on real Claude Code. One `claude -p --input-format stream-json
// --output-format stream-json` process per conversation, kept running: each message is written to it, each event
// it prints becomes a page event. Runs in the crew folder (its CLAUDE.md, agents, skills, settings) with the films
// workspace added, on the Claude account in use. What the page sees:
//   text / delta      the Director's words (delta: while it types)
//   tool              a step it takes (a file read, a command…)
//   brief / briefDone a job handed to a crew agent (the Agent tool) and its result
//   sub               a crew agent's own steps and words while it works (parent = the brief)
//   permission        a command Claude Code asks about (answered from the page)
//   result / limit / exit
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { baseDir, config, saveConfig } from './config.js';
import * as history from './history.js';
import { crewDir, isolation, isolationEnv, kitOf, crews, useCrew, createCrew, isHead, studioDir, instructionsOf, saveInstructions, syncShared, skills } from './crew.js';
import { usage, agentMetas } from './usage.js';
import { findClaude, cleanEnv, LIMIT } from './terminal.js';
import * as accounts from './accounts.js';
import * as harness from './harness.js';

// auto: Claude Code's auto mode (its own safety check decides); acceptEdits: edits go ahead, commands ask the page
const MODES = ['auto', 'acceptEdits'];
export const modeOf = () => MODES.includes(config().directorMode) ? config().directorMode : 'auto';
export function setMode({ mode }: { mode?: any } = {}) { if (!MODES.includes(mode)) throw Object.assign(new Error('mode is auto or acceptEdits'), { code: 400 }); saveConfig({ directorMode: mode }); return { mode, restart: !!run }; }
// the conversation the chat continues: the last one of the crew folder (a new one after "New conversation")
let run = null, sessionId, sessionHarness = 'claude', notify: (ev: DirectorEvent) => void = () => { }, seq = 0;   // sessionHarness: whose conversation sessionId is
// the chosen conversation is remembered per crew folder (in VideoHub's settings) and stays open until you pick or start another
const chosen = () => (config().directorSessions || {})[crewDir()];
function remember() { if (sessionId === undefined) return; const all = { ...(config().directorSessions || {}) }; all[crewDir()] = { id: sessionId, harness: sessionHarness }; saveConfig({ directorSessions: all }); }
const current = () => {
  if (sessionId === undefined) {
    const c = chosen();
    if (c && typeof c === 'object') { sessionId = c.id ?? null; sessionHarness = c.harness || 'claude'; }
    else { sessionHarness = 'claude'; try { sessionId = history.list().find(x => x.resumable)?.id || null; } catch { sessionId = null; } }
  }
  return sessionId;
};
const events = [];   // this conversation's events since VideoHub started (a page that opens later replays them)
export const onDirector = fn => { notify = fn; };
export const busy = () => !!(run?.working || run?.bg?.size);   // the Director's turn, or crew agents still working
let convBriefs = new Map();   // this conversation's briefs: kept when its process restarts (Stop, new skills…), so continued agents keep their names
const emit = ev => { ev.seq = ++seq; ev.at = Date.now(); events.push(ev); if (events.length > 3000) events.splice(0, events.length - 3000); notify(ev); };
const short = (v, n = 160) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const summary = (name: string, i: Record<string, any> = {}) => short(i.description || i.command || i.file_path || i.pattern || i.url || i.skill || i.prompt || i.query || '');
const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => b.type === 'text' ? b.text : '').join('\n') : '';

// cost shown under each reply. Claude Code's result carries running totals for the conversation (crew agents included,
// restored on resume), so one reply = these totals minus the last ones seen; estimates at API prices, not a bill
// a page event: what the chat shows (kind says which; the other fields depend on it, see toEvents)
export type DirectorEvent = { kind: string; [field: string]: unknown };
// per model family: all tokens and the estimated cost, as running totals for the conversation
export type ModelTotals = Record<string, { tokens: number; cost: number }>;
export const modelTotals = (mu: Record<string, Record<string, number>> | undefined): ModelTotals => Object.fromEntries(Object.entries(mu || {}).map(([k, u]) => [k, { tokens: (u.inputTokens || 0) + (u.outputTokens || 0) + (u.cacheReadInputTokens || 0) + (u.cacheCreationInputTokens || 0), cost: u.costUSD || 0 }]));
export function replyShare(prev: { cost: number; models?: ModelTotals } | undefined, now: { cost: number; models?: ModelTotals }): { cost: number; models: ModelTotals } | null {
  if (!prev || !(now.cost >= prev.cost)) return null;   // unknown start (VideoHub restarted) or a zeroed crash result
  const models = {};
  for (const [k, v] of Object.entries(now.models || {})) { const p = prev.models?.[k] || { tokens: 0, cost: 0 }; if (v.tokens > p.tokens) models[k] = { tokens: v.tokens - p.tokens, cost: v.cost - p.cost }; }
  return { cost: now.cost - prev.cost, models };
}
const spent = new Map();   // conversation id → its last running totals

// crew agents usually run in the background: their launch returns at once ("Async agent launched … agentId: X") and
// a <task-notification> (or a task_notification system message) says later that they finished, failed or were stopped.
// briefs maps a brief's tool id → agent name, and 'agent:<agentId>' → that brief's tool id (SendMessage continues it)
const tag = (s, t) => (new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(s) || [])[1]?.trim() || '';
// A notice names the agent in task-id and the call that last ran it in tool-use-id: the first Agent call, or the
// SendMessage that continued it, so the agent id is matched first. A notice that is no crew agent's (a background
// command the agent ran: ffmpeg, python…) gives no event. An agent id VideoHub has not seen (it restarted since):
// id null, the caller looks it up in Claude Code's log of that agent (agentMetas).
function finished(briefs, toolId, taskId, status, text) {
  const id = briefs.get('agent:' + taskId) || (briefs.has(toolId) ? toolId : null);
  if (!id && !/^a[0-9a-f]{8,}$/.test(String(taskId))) return [];
  return [{ kind: 'briefDone', id, agent: briefs.get(id) || 'crew agent', agentId: taskId || briefs.get('aid:' + id), ok: status === 'completed', status: status || 'completed', text: String(text || '').slice(0, 4000) }];
}
// one stream-json message → page events (exported for the tests)
export function toEvents(m, briefs = new Map()) {
  const out = [], parent = m.parent_tool_use_id || null;
  // init also names what can be typed after "/": the skills and commands that work in this (non-terminal) mode
  if (m.type === 'system' && m.subtype === 'init') return [{ kind: 'session', sessionId: m.session_id, model: m.model, ...(Array.isArray(m.slash_commands) ? { commands: m.slash_commands.filter(c => !(m.terminal_slash_commands || []).includes(c)) } : {}) }];
  if (m.type === 'system' && m.subtype === 'task_notification') return finished(briefs, m.tool_use_id, m.task_id, m.status, m.summary);
  if (m.type === 'stream_event' && !parent) { const d = m.event?.delta; if (m.event?.type === 'content_block_delta' && d?.type === 'text_delta') out.push({ kind: 'delta', text: d.text }); return out; }
  if (m.type === 'assistant') for (const b of m.message?.content || []) {
    if (b.type === 'text' && b.text.trim()) out.push(parent ? { kind: 'sub', parent, agent: briefs.get(parent), what: 'text', text: short(b.text, 600) } : { kind: 'text', text: b.text });
    if (b.type === 'tool_use') {
      if (!parent && (b.name === 'Agent' || b.name === 'Task')) { const agent = b.input?.subagent_type || 'general-purpose'; briefs.set(b.id, agent); out.push({ kind: 'brief', id: b.id, agent, description: short(b.input?.description, 200), prompt: String(b.input?.prompt || '').slice(0, 4000) }); }
      else if (!parent && b.name === 'SendMessage' && briefs.has('agent:' + b.input?.to)) { const id = briefs.get('agent:' + b.input.to); out.push({ kind: 'briefResume', id, agent: briefs.get(id), text: short(b.input?.summary || b.input?.message, 200) }); }
      else out.push(parent ? { kind: 'sub', parent, agent: briefs.get(parent), what: 'tool', name: b.name, text: summary(b.name, b.input) } : { kind: 'tool', id: b.id, name: b.name, text: summary(b.name, b.input) });
    }
  }
  if (m.type === 'user' && !parent) {
    const c = m.message?.content, texts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text) : [];
    for (const t of texts) for (const n of t.match(/<task-notification>[\s\S]*?<\/task-notification>/g) || []) out.push(...finished(briefs, tag(n, 'tool-use-id'), tag(n, 'task-id'), tag(n, 'status'), tag(n, 'result') || tag(n, 'summary')));
  }
  if (m.type === 'user' && Array.isArray(m.message?.content)) for (const b of m.message.content) {
    if (b.type !== 'tool_result') continue;
    const said = textOf(b.content), bg = /^Async agent launched/.test(said);
    if (!parent && briefs.has(b.tool_use_id) && bg) { const aid = /agentId: (\w+)/.exec(said)?.[1]; if (aid) { briefs.set('agent:' + aid, b.tool_use_id); briefs.set('aid:' + b.tool_use_id, aid); } out.push({ kind: 'briefBackground', id: b.tool_use_id, agent: briefs.get(b.tool_use_id) }); }
    else if (!parent && briefs.has(b.tool_use_id)) out.push({ kind: 'briefDone', id: b.tool_use_id, agent: briefs.get(b.tool_use_id), ...(/agentId: (\w+)/.test(said) ? { agentId: /agentId: (\w+)/.exec(said)[1] } : {}), ok: !b.is_error, status: b.is_error ? 'failed' : 'completed', text: said.slice(0, 4000) });
    else if (!parent && b.is_error) out.push({ kind: 'toolError', id: b.tool_use_id, text: short(said, 400) });
  }
  if (m.type === 'result') {
    const text = m.subtype === 'success' ? '' : String(m.result || m.error?.message || m.subtype || '');
    out.push({ kind: 'result', ok: m.subtype === 'success' && !m.is_error, text: short(m.result && m.is_error ? m.result : text, 600), cost: m.total_cost_usd || 0, models: modelTotals(m.modelUsage) });
    if (LIMIT.test(String(m.result || '').replace(/\s+/g, ''))) out.push({ kind: 'limit' });
  }
  return out;
}

// the coding agent to start: [command, …its first args] (tests pass their own)
function command(h, cmd, preArgs) {
  if (cmd) return [cmd, ...preArgs];
  const c = harness.HARNESSES[h].find();
  if (!c) throw Object.assign(new Error(`${harness.HARNESSES[h].label} was not found. Install it (${harness.HARNESSES[h].site}), then check Crew > Requirements.`), { code: 400 });
  return c;
}
const lastLines = (r, label, code) => r.stderr.trim().split('\n').slice(-3).join(' ') || `${label} stopped (exit ${code})`;
// Claude Code and Qwen Code: one process for the conversation, stream-json both ways
function startProcess({ resume }: { resume?: string | null } = {}, cmd?: string, preArgs: string[] = []) {
  const h = harness.current(), H = harness.HARNESSES[h], [exe, ...first] = command(h, cmd, preArgs);
  try { syncShared(); } catch { }   // the shared agents, as they are now
  if (h !== 'claude') harness.mirror(h, crewDir());
  const account = accounts.active(), mode = modeOf();
  // the Director of directors also sees the whole studio folder (every crew); every Director can find Claude Code
  const proc = spawn(exe, [...first, ...H.args({ resume, mode }), ...(isHead() ? ['--add-dir', studioDir()] : []), ...(h === 'claude' && !cmd ? isolation() : []), ...(h === 'claude' && !cmd && config().chrome ? ['--chrome'] : [])], { cwd: crewDir(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...cleanEnv(), ...(h === 'claude' ? accounts.envFor(account) : {}), ...(h === 'claude' && !cmd ? isolationEnv : {}), VIDEOHUB_CLAUDE: findClaude() || '' } });
  const r = { stopped: false, proc, harness: h, account, kit: JSON.stringify(kitOf()), working: false, briefs: convBriefs, bg: new Set(), done: new Set(), seen: new Map(), pending: new Map(), stderr: '' };
  const check = setInterval(() => catchUp(r), 30e3); check.unref();
  readline.createInterface({ input: proc.stdout }).on('line', line => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.type === 'control_request' && m.request?.subtype === 'can_use_tool') {
      r.pending.set(m.request_id, m.request.input);
      return emit({ kind: 'permission', requestId: m.request_id, name: m.request.tool_name, text: summary(m.request.tool_name, m.request.input), detail: short(JSON.stringify(m.request.input), 600) });
    }
    if ((m.type === 'system' && m.subtype === 'init') || (m.session_id && !sessionId)) { const was = sessionId; sessionId = m.session_id; sessionHarness = h; if (was !== sessionId) remember(); }
    if (m.type === 'rate_limit_event' && h === 'claude') return emit({ kind: 'usage', account: r.account, usage: accounts.recordUsage(r.account, m.rate_limit_info) });
    for (const ev of toEvents(m, r.briefs)) {
      if (ev.kind === 'session' && ev.commands) commands = ev.commands;
      if (ev.kind === 'result') { r.working = false; ev.reply = replyShare(spent.get(sessionId), ev); if (ev.cost > 0) spent.set(sessionId, { cost: ev.cost, models: ev.models }); }
      if (ev.kind === 'limit') ev.account = r.account;
      // a finished notice for an agent VideoHub has not seen launch (it restarted since): Claude Code's log names its call
      if (ev.kind === 'briefDone' && !ev.id) {
        const meta = agentMetas({ cwd: crewDir(), session: sessionId }).find(x => x.agentId === ev.agentId); if (!meta) continue;
        Object.assign(ev, { id: meta.toolUseId, agent: meta.agentType || ev.agent }); r.briefs.set('agent:' + ev.agentId, ev.id);
      }
      // crew agents still at work after the Director's turn: they keep the Director busy (Stop, restarts, idle close).
      // A step that arrives after an agent's finished notice does not bring it back to "working"; a SendMessage does.
      const id = ev.id || ev.parent;
      if (ev.kind === 'briefBackground' || ev.kind === 'briefResume' || (ev.kind === 'sub' && !r.working && !r.done.has(id))) { r.bg.add(id); r.seen.set(id, Date.now()); if (ev.kind === 'briefResume') r.done.delete(id); }
      if (ev.kind === 'sub') r.seen.set(id, Date.now());
      if (ev.kind === 'briefDone') { r.bg.delete(ev.id); r.done.add(ev.id); }
      if (['result', 'briefBackground', 'briefResume', 'briefDone'].includes(ev.kind) || (ev.kind === 'sub' && r.bg.has(ev.parent))) { ev.busy = busy(); ev.agents = r.bg.size; }
      emit(ev);
    }
  });
  proc.stderr.on('data', d => { r.stderr = (r.stderr + d).slice(-4000); });
  proc.on('error', e => emit({ kind: 'exit', error: e.message }));
  proc.on('close', code => { clearInterval(check); const mine = run === r; if (mine) run = null; if (mine || !run) emit({ kind: 'exit', code, error: code && !r.stopped ? lastLines(r, H.label, code) : null }); });   // a stopped process that closes after a new one started says nothing
  return r;
}
// the safety net for agents shown "working" whose finished notice never came: Claude Code marks each agent finished in
// its own log (agent-<id>.meta.json); one finished after its last step here (and quiet for a minute) is done
export function stale(bg, seen, metas, now = Date.now()) {
  return [...bg].flatMap(id => { const m = metas.find(x => x.toolUseId === id), last = seen.get(id) || 0;
    return m?.finished && m.mtime >= last && now - last > 60e3 ? [{ id, meta: m }] : []; });
}
function catchUp(r) {
  if (!r.bg.size || !sessionId) return;
  for (const { id, meta } of stale(r.bg, r.seen, agentMetas({ cwd: crewDir(), session: sessionId }))) {
    r.bg.delete(id); r.done.add(id);
    emit({ kind: 'briefDone', id, agent: meta.agentType || 'crew agent', agentId: meta.agentId, ok: true, status: 'completed', text: 'Finished. (VideoHub read this from Claude Code\'s own log: the usual "finished" notice did not arrive.)', busy: busy(), agents: r.bg.size });
  }
}
// OpenCode: one `opencode run --format json` per message, the conversation continued by its session id
function runOnce(text: string, cmd?: string, preArgs: string[] = []) {
  const H = harness.HARNESSES.opencode, [exe, ...first] = command('opencode', cmd, preArgs);
  harness.mirror('opencode', crewDir());
  const proc = spawn(exe, [...first, ...H.run(text, sessionHarness === 'opencode' ? sessionId : null)], { cwd: crewDir(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv() });
  const r = { stopped: false, proc, harness: 'opencode', account: null, working: true, briefs: new Map(), pending: new Map(), stderr: '', failed: false };
  readline.createInterface({ input: proc.stdout }).on('line', line => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.sessionID) { const was = sessionId; sessionId = m.sessionID; sessionHarness = 'opencode'; if (was !== sessionId) remember(); }
    for (const ev of harness.openCodeEvents(m)) { if (ev.kind === 'result') { r.failed = true; r.working = false; } emit(ev); }
  });
  proc.stderr.on('data', d => { r.stderr = (r.stderr + d).slice(-4000); });
  proc.on('error', e => emit({ kind: 'exit', error: e.message }));
  proc.on('close', code => { const mine = run === r; if (mine) run = null; if (!mine && run) return; if (!r.failed) emit({ kind: 'result', ok: !code, text: code && !r.stopped ? lastLines(r, H.label, code) : '' }); emit({ kind: 'exit', code: 0 }); });
  return r;
}

// a message from you (or from VideoHub: review notes, a script question): starts the conversation if needed
export function say({ text }: { text?: string } = {}, cmd?: string, preArgs?: string[]) {
  if (typeof text !== 'string' || !text.trim()) throw Object.assign(new Error('Say or write something first.'), { code: 400 });
  const h = harness.current();
  if (run && run.harness !== h) stop();   // the coding agent was changed: the next message starts it
  if (h === 'opencode') {
    if (run) throw Object.assign(new Error('The Director is still answering; wait or press Stop.'), { code: 409 });
    emit({ kind: 'user', text }); run = runOnce(text, cmd, preArgs); return { ok: true };
  }
  if (run?.kit && !busy() && run.kit !== JSON.stringify(kitOf())) stop();   // its skills or tools changed: start again with them (same conversation)
  if (!run) run = startProcess({ resume: sessionHarness === h ? current() : null }, cmd, preArgs);
  run.working = true;
  emit({ kind: 'user', text });
  run.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
  return { ok: true, started: true };
}
export function answer({ requestId, allow }: { requestId?: any; allow?: any } = {}) {
  const input = run?.pending.get(requestId);
  if (!run || input === undefined) throw Object.assign(new Error('That question is no longer open.'), { code: 409 });
  run.pending.delete(requestId);
  run.proc.stdin.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The user said no.' } } }) + '\n');
  emit({ kind: 'answered', requestId, allow: !!allow });
  return { ok: true };
}
export function stop() { if (run) { run.stopped = true; run.proc.kill(); run = null; } return { ok: true }; }   // forgotten at once: the next message starts a new process   // the conversation is kept: the next message resumes it
// another crew (another Director): its own conversation, picked up from its folder's history
export function reset() { stop(); sessionId = undefined; convBriefs = new Map(); commands = null; events.length = 0; emit({ kind: 'new', crew: true }); return { ok: true }; }
export const KICKOFF = about => `Set up your crew for this content: ${about}
Read the descriptions of the skills in ~/.claude/skills, decide which specialists this content needs, create each one as an agent in .claude/agents with the right skills, then tell me the crew you built and how you will use it.`;
export function fresh() { stop(); sessionId = null; convBriefs = new Map(); sessionHarness = harness.current(); remember(); events.length = 0; emit({ kind: 'new' }); return { ok: true }; }
export function open({ session }: { session?: any } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(session))) throw Object.assign(new Error('bad conversation id'), { code: 400 });
  stop(); sessionId = session; convBriefs = new Map(); sessionHarness = 'claude'; remember(); events.length = 0; emit({ kind: 'opened', sessionId: session }); return { ok: true };
}
// archive or delete a past conversation; the open one: the chat starts a new conversation (never while it works)
export function forget({ id, how }: { id?: any; how?: any } = {}) {
  const open = current() === id;
  if (open && busy()) throw Object.assign(new Error('The Director is working in this conversation: stop it first.'), { code: 409 });
  const r = how === 'delete' ? history.remove({ id }) : history.archive({ id, on: how !== 'unarchive' });
  if (open && how !== 'unarchive') fresh();
  return r;
}
// what can follow "/": what Claude Code announced at its last start, else (not started yet) the crew's skills
let commands = null;
const commandList = () => { if (commands) return commands; try { return skills(); } catch { return []; } };
export function state() { return { commands: commandList(), running: !!run, working: !!run?.working, busy: busy(), agents: run?.bg?.size || 0, sessionId: current(), harness: harness.current(), harnessLabel: harness.HARNESSES[harness.current()].label, mode: modeOf(), account: run?.account || accounts.active(), events: events.slice(-1500) }; }

// a file you attach in the chat (a video to edit…): streamed into <workspace>/inbox, which the Director can read
export const safeName = name => path.posix.basename(String(name || '').replace(/\\/g, '/').replace(/[<>:"|?*\x00-\x1f]/g, '_')).replace(/^\.+/, '').slice(-120) || 'file';
export async function attach(req, name) {
  const dir = path.join(baseDir(), 'inbox'); await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${safeName(name)}`);
  try { await pipeline(req, fs.createWriteStream(file, { flags: 'wx' })); }
  catch (e) { await fs.promises.rm(file, { force: true }); throw e; }   // only our own half-written copy
  return { path: file };
}

export function routes(route, readBody) {
  route('GET', '/api/director', () => state());
  // tokens and cost of a conversation (default: the most recent) or of one crew agent run, from Claude Code's logs
  route('GET', '/api/director/usage', (req, url) => usage({ cwd: crewDir(), session: url.searchParams.get('session') || undefined, agent: url.searchParams.get('agent') || undefined }));
  route('POST', '/api/director/attach', (req, url) => attach(req, url.searchParams.get('name')));
  route('POST', '/api/director/say', async req => say(await readBody(req)));
  route('POST', '/api/director/permission', async req => answer(await readBody(req)));
  route('POST', '/api/director/stop', () => stop());
  route('POST', '/api/director/new', () => fresh());
  route('POST', '/api/director/open', async req => open(await readBody(req)));
  route('POST', '/api/crew/history/forget', async req => forget(await readBody(req)));
  route('POST', '/api/director/mode', async req => setMode(await readBody(req)));
  route('GET', '/api/crews', () => crews());
  route('GET', '/api/crews/instructions', (req, url) => instructionsOf({ dir: url.searchParams.get('dir') }));
  route('POST', '/api/crews/instructions', async req => saveInstructions(await readBody(req)));
  route('POST', '/api/crews/use', async req => { const r = useCrew(await readBody(req)); reset(); return r; });
  route('POST', '/api/crews', async req => { const c = createCrew(await readBody(req)); reset(); say({ text: KICKOFF(c.about) }); return c; });
  route('GET', '/api/harness', () => ({ current: harness.current(), list: harness.list() }));
  route('POST', '/api/harness', async req => { const r = harness.use(await readBody(req)); stop(); return r; });
}

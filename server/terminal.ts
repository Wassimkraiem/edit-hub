// @ts-nocheck
// TypeScript rewrite: not type-checked yet. Remove the line above and fix the errors to check this file.
// local addition: the Crew page's Director, a real interactive Claude Code terminal (node-pty) running in the
// crew folder (crew.js), so its CLAUDE.md, .claude/agents, skills and settings apply as in any Claude session.
// One terminal; it outlives page reloads (the page replays the recent output) and keeps the hub awake while it runs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import pty from 'node-pty';
import { config, saveConfig, baseDir } from './config.js';
import { crewDir, isolation, isolationEnv } from './crew.js';
import * as accounts from './accounts.js';
import * as harness from './harness.js';

const HOME = os.homedir();
const KEEP = 400_000;   // characters of output kept for a page that opens later

// which claude to run: config agent.claude → VIDEOHUB_CLAUDE → PATH → native install → the desktop app's copy
export function findClaude(env = process.env, exists = fs.existsSync, home = HOME) {
  const set = config().agent?.claude || env.VIDEOHUB_CLAUDE;
  if (set) return set;
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  for (const dir of String(env.PATH || '').split(path.delimiter).filter(Boolean)) if (exists(path.join(dir, exe))) return path.join(dir, exe);
  const native = path.join(home, '.local', 'bin', exe); if (exists(native)) return native;
  // the Claude desktop app keeps its own copy under %APPDATA%\Claude\claude-code\<version>\<hash>\claude.exe; newest wins
  const appDir = path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude-code');
  try {
    const found = fs.readdirSync(appDir).flatMap(v => { try { return fs.readdirSync(path.join(appDir, v)).map(h => path.join(appDir, v, h, exe)); } catch { return []; } }).filter(f => exists(f));
    if (found.length) return found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  } catch { }
  return null;
}

// a hub started from inside a Claude Code session inherits that session's markers (child session: no transcript
// saved, its session id, its API address…); the Director must be a Claude of its own, like one from the Start menu
const HOST = /^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_AGENT_SDK_.*|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_.*|ANTHROPIC_BASE_URL)$/;
export function cleanEnv(env = process.env) {
  if (!env.CLAUDECODE && !env.CLAUDE_CODE_SESSION_ID && !env.CLAUDE_CODE_CHILD_SESSION) return { ...env };
  return Object.fromEntries(Object.entries(env).filter(([k]) => !HOST.test(k)));
}
let term = null, buf = '', pending = '', flushT = null, lastOut = 0, notify = () => { };
// the account a usage limit stopped: the page offers the other one (the screen moves the cursor instead of printing
// spaces, so the words are matched without them)
let runAccount = null, limitSeen = false;
export const LIMIT = /hityour(w{0,12})limit|usagelimitreached|limitreached(W|resets)/i;
function checkLimit() {
  if (limitSeen) return;
  if (LIMIT.test(buf.slice(-3000).replace(/[[0-9;?>]*[A-Za-z]/g, '').replace(/s+/g, ''))) { limitSeen = true; notify({ kind: 'limit', account: runAccount }); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const onTerm = fn => { notify = fn; };
export const busy = () => !!term;
const size = (v, d, max) => Number.isInteger(v) && v > 0 && v <= max ? v : d;
const flush = () => { flushT = null; if (pending) { notify({ kind: 'data', data: pending }); pending = ''; } };

// Code Mode (experimental, Claude Code ≥ 2.1.323): Claude writes JavaScript that makes several tool calls at once. It works
// only in an interactive terminal session, so only this terminal Director gets it, from its next start; a conversation
// started in Code Mode can only be resumed with it on (Claude Code's rule)
const codeMode = () => !!config().codeMode;
export function setCodeMode({ on }: { on?: any } = {}) { saveConfig({ codeMode: !!on }); return { codeMode: !!on, restart: !!term }; }
export function state() { return { codeMode: codeMode(), alive: !!term, output: buf, cwd: crewDir(), claude: findClaude(), account: term ? runAccount : accounts.active(), limit: !!(term && limitSeen) }; }

// the Director runs in the crew folder (its CLAUDE.md, agents, skills, settings) with the films workspace added;
// resume: continue that folder's last conversation (claude --continue); session: that past conversation (claude --resume <id>)
// account: which Claude account runs it (accounts.js; the active one by default)
export function start({ cols, rows, resume, session, account }: { cols?: any; rows?: any; resume?: any; session?: any; account?: any } = {}, cmd = null, args = null) {
  // the coding agent chosen for the Director (harness.js), unless a caller names its own program
  const h = cmd ? 'claude' : harness.current();
  if (!cmd && h !== 'claude') { const c = harness.HARNESSES[h].find(); if (!c) throw Object.assign(new Error(harness.HARNESSES[h].label + ' was not found.'), { code: 400 }); harness.mirror(h, crewDir()); [cmd, ...args] = [...c, ...(args || harness.HARNESSES[h].terminal())]; }
  cmd ||= findClaude();
  if (account && !accounts.list().includes(account)) throw Object.assign(new Error('No such account: ' + account), { code: 400 });
  if (session && !/^[0-9a-f-]{36}$/i.test(session)) throw Object.assign(new Error('bad conversation id'), { code: 400 });
  if (term) return state();
  if (!cmd) throw Object.assign(new Error('Claude Code was not found. Install it (claude.ai/install) or set its path in data/config.json → agent.claude.'), { code: 400 });
  const cwd = crewDir();
  buf = '';
  term = pty.spawn(cmd, args || ['--add-dir', baseDir(), ...isolation(), ...(config().chrome ? ['--chrome'] : []),...(session ? ['--resume', session] : resume ? ['--continue'] : [])], { name: 'xterm-256color', cols: size(cols, 120, 500), rows: size(rows, 32, 200), cwd, env: { ...cleanEnv(), ...accounts.envFor(account || accounts.active()), ...(args ? {} : isolationEnv), ...(!args && h === 'claude' && codeMode() ? { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: '1' } : {}) } });
  runAccount = account || accounts.active(); limitSeen = false;
  term.onData(d => { lastOut = Date.now(); buf = (buf + d).slice(-KEEP); pending += d; flushT ||= setTimeout(flush, 16); checkLimit(); });
  term.onExit(({ exitCode }) => { flush(); term = null; notify({ kind: 'exit', code: exitCode }); });
  notify({ kind: 'start' });
  return state();
}
export function input({ data }: { data?: any } = {}) {
  if (typeof data !== 'string') throw Object.assign(new Error('data must be text'), { code: 400 });
  if (!term) throw Object.assign(new Error('The Director is not running. Press Start.'), { code: 409 });
  term.write(data); return { ok: true };
}
// a message from elsewhere in VideoHub (review notes, a thumbnail brief) typed into the Director as one paste and
// sent; a Director that is not running is started on its last conversation first and given time to draw its prompt.
// Claude Code queues it if the Director is busy.
export async function say({ text }: { text?: any } = {}, quietMs = 1500, maxWaitMs = 30000) {
  if (typeof text !== 'string' || !text.trim()) throw Object.assign(new Error('Nothing to send.'), { code: 400 });
  const started = !term;
  if (started) start({ resume: true });
  if (started) { const t0 = Date.now(); while (Date.now() - t0 < maxWaitMs && !(lastOut && Date.now() - lastOut > quietMs)) await sleep(200); }
  if (!term) throw Object.assign(new Error('The Director stopped before the message could be sent.'), { code: 409 });
  // Claude's first-run question about the folder must be answered by you, never by this Enter
  // (the screen moves the cursor instead of printing spaces, so compare without them)
  if (/trustthisfolder/i.test(buf.slice(-6000).replace(/\x1b\[[0-9;?>]*[A-Za-z]/g, '').replace(/\s+/g, ''))) throw Object.assign(new Error('Claude is asking whether you trust the crew folder. Open Crew, answer it, then send again.'), { code: 409 });
  term.write('\x1b[200~' + text.replace(/\r\n?/g, '\n') + '\x1b[201~');   // bracketed paste: newlines stay inside the message
  await sleep(400); term?.write('\r');
  return { ok: true, started };
}
export function resize({ cols, rows }: { cols?: any; rows?: any } = {}) { if (term) term.resize(size(cols, term.cols, 500), size(rows, term.rows, 200)); return { ok: true }; }
export function stop() { if (term) term.kill(); return { ok: true }; }

export function routes(route, readBody) {
  route('GET', '/api/term', () => state());
  route('POST', '/api/term/start', async req => start(await readBody(req)));
  route('POST', '/api/term/codemode', async req => setCodeMode(await readBody(req)));
  route('POST', '/api/term/login', async req => start(await readBody(req), findClaude(), ['auth', 'login']));   // sign in, in the terminal (body.account: which account)
  route('GET', '/api/accounts', () => accounts.status(findClaude(), cleanEnv()));
  route('POST', '/api/accounts', async req => accounts.add(await readBody(req)));
  route('POST', '/api/accounts/use', async req => accounts.use(await readBody(req)));
  route('POST', '/api/accounts/usage', async req => accounts.checkUsage((await readBody(req)).id, findClaude(), cleanEnv()));
  route('POST', '/api/accounts/remove', async req => accounts.remove(await readBody(req)));
  route('POST', '/api/term/input', async req => input(await readBody(req)));
  route('POST', '/api/term/say', async req => say(await readBody(req)));
  route('POST', '/api/term/resize', async req => resize(await readBody(req)));
  route('POST', '/api/term/stop', () => stop());
}

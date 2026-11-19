// @ts-nocheck
// TypeScript rewrite: not type-checked yet. Remove the line above and fix the errors to check this file.
// local addition: more than one Claude account for the crew. "main" is your usual login (~/.claude). Every other
// account is a Claude Code config folder of its own (CLAUDE_CONFIG_DIR = ~/.claude-accounts/<id>) holding only its
// own login; skills, agents, plugins, commands, hooks and the conversation history (projects) are links to
// ~/.claude, and settings.json, CLAUDE.md and .claude.json (MCP servers, trusted folders) are copied from it at each
// start, so the Director is the same Director on any account. The active one is a setting (activeAccount).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import readline from 'node:readline';
import { DATA_DIR, readJson, writeJson } from './util.js';
import { config, saveConfig } from './config.js';

const HOME = () => process.env.VIDEOHUB_CLAUDE_HOME || os.homedir();
const MAIN = () => path.join(HOME(), '.claude');
const ROOT = () => path.join(HOME(), '.claude-accounts');
const ID = /^[a-z0-9][a-z0-9-]{0,30}$/;
const LINKED = ['skills', 'agents', 'plugins', 'commands', 'hooks', 'output-styles', 'projects'];
const COPIED = ['settings.json', 'CLAUDE.md', 'keybindings.json'];
const bad = (m, code = 400) => Object.assign(new Error(m), { code });

export const list = () => ['main', ...((config().accounts || []).filter(a => ID.test(a) && a !== 'main'))];
export const active = () => list().includes(config().activeAccount) ? config().activeAccount : 'main';
export const dirOf = id => id === 'main' ? MAIN() : path.join(ROOT(), id);

// make an extra account's folder match ~/.claude, keeping its own login
export function prepare(id) {
  if (id === 'main') return;
  const dir = dirOf(id); fs.mkdirSync(dir, { recursive: true });
  for (const n of LINKED) {
    const target = path.join(MAIN(), n), link = path.join(dir, n);
    if (!fs.existsSync(target) || fs.existsSync(link)) continue;
    fs.symlinkSync(target, link, 'junction');
  }
  for (const n of COPIED) { const f = path.join(MAIN(), n); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dir, n)); }
  // .claude.json: this account's own state, with only what must match yours copied in (MCP servers such as
  // VideoHub's tools, trusted folders, a few preferences). Never the rest: it holds account caches (usage, model
  // access, plan, feature flags) that would make this account show the main account's numbers.
  const mainState = path.join(HOME(), '.claude.json'), own = path.join(dir, '.claude.json');
  let m = {}, o = {}; try { m = JSON.parse(fs.readFileSync(mainState, 'utf8')); } catch { } try { o = JSON.parse(fs.readFileSync(own, 'utf8')); } catch { }
  if (!o.videohubOwnState) o = cleanState(o);   // once: drop the main account's caches an earlier VideoHub copied in
  fs.writeFileSync(own, JSON.stringify({ ...o, ...pick(m, SHARED_STATE), videohubOwnState: 1 }, null, 2));
}
const SHARED_STATE = ['mcpServers', 'projects', 'theme', 'editorMode', 'autoUpdates', 'hasCompletedOnboarding', 'lastOnboardingVersion'];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));
const ACCOUNT_CACHE = /cache|cached|usage|access|subscription|eligib|statsig|growthbook|featureflag|experiment|grove|penguin|s1m|orgmodel|extra/i;
export const cleanState = o => Object.fromEntries(Object.entries(o).filter(([k]) => k === 'oauthAccount' || k === 'userID' || !ACCOUNT_CACHE.test(k)));
// the environment for Claude on that account
export function envFor(id = active()) { if (id === 'main') return {}; prepare(id); return { CLAUDE_CONFIG_DIR: dirOf(id) }; }

export function add({ id }: { id?: any } = {}) {
  id = String(id || '').trim().toLowerCase();
  if (!ID.test(id) || id === 'main') throw bad('Name it with lowercase letters, digits and dashes, e.g. second.');
  const accounts = list().filter(a => a !== 'main');
  if (accounts.includes(id)) throw bad('That account already exists.');
  saveConfig({ accounts: [...accounts, id] }); prepare(id); return { id };
}
export function use({ id }: { id?: any } = {}) { if (!list().includes(id)) throw bad('No such account: ' + id); saveConfig({ activeAccount: id }); return { active: id }; }
export function remove({ id }: { id?: any } = {}) {
  if (id === 'main' || !list().includes(id)) throw bad('That account cannot be removed.');
  saveConfig({ accounts: list().filter(a => a !== 'main' && a !== id), ...(active() === id ? { activeAccount: 'main' } : {}) });
  return { removed: id };   // shortcut: its folder stays (its login), delete ~/.claude-accounts/<id> by hand to forget it
}
// who each account is logged in as (claude auth status, run with that account's folder)
export async function status(claude, baseEnv) {
  const one = id => new Promise(r => {
    if (!claude) return r({ id, loggedIn: false });
    execFile(claude, ['auth', 'status'], { windowsHide: true, timeout: 20000, env: { ...baseEnv, ...envFor(id) } }, (e, out) => {
      let s = null; try { s = JSON.parse(out); } catch { }
      r({ id, loggedIn: !!s?.loggedIn, email: s?.email || null, plan: s?.subscriptionType || null, usage: usageOf(id) });
    });
  });
  return { active: active(), accounts: await Promise.all(list().map(one)) };
}

// usage per account, as Claude Code reports it after each reply (rate_limit_event: the 5-hour and weekly windows,
// how full each is, when it resets); kept in data/account-usage.json so it survives a restart
const USAGE = () => path.join(DATA_DIR, 'account-usage.json');
export function recordUsage(id, info) {
  const w = info?.unifiedWindows || {}, pct = x => typeof x?.utilization === 'number' ? Math.round(x.utilization * 100) : null;
  // a Director reply reports the session and the week: it replaces the last /usage reading (the newest wins)
  const u = { fiveHour: pct(w.five_hour), fiveHourResets: w.five_hour?.resetsAt || null, week: pct(w.seven_day), weekResets: w.seven_day?.resetsAt || null, status: info?.status || null, at: Date.now() };
  const all = readJson(USAGE(), {}) || {}; all[id] = u; writeJson(USAGE(), all); return u;
}
export const usageOf = id => (readJson(USAGE(), {}) || {})[id] || null;
// Claude Code's own /usage text ("Current session: 78% used · resets Nov 16, 7:30pm (Africa/Tunis)", "Current week
// (all models): 6% used · resets …", "Current week (Fable): 0% used · …") → usage (exported for the tests)
export function parseUsage(text) {
  const windows = [...String(text).matchAll(/^\s*(Current session|Current week \(([^)]+)\)):\s*(\d+)% used(?:\s*·\s*(resets .+))?$/gm)]
    .map(m => ({ label: m[2] ? `This week (${m[2]})` : 'Current session', pct: +m[3], resets: (m[4] || '').trim() }));
  if (!windows.length) return null;
  const s = windows.find(w => w.label === 'Current session'), wk = windows.find(w => /all models/i.test(w.label)) || windows.find(w => w.label !== 'Current session');
  return { fiveHour: s?.pct ?? null, fiveHourResetText: s?.resets || null, fiveHourResets: null, week: wk?.pct ?? null, weekResetText: wk?.resets || null, weekResets: null, windows, at: Date.now() };
}
// fresh numbers for one account: Claude Code's own /usage (what Claude's usage screen shows; no model call)
export function checkUsage(id, claude, baseEnv) {
  if (!list().includes(id)) throw bad('No such account: ' + id);
  return new Promise((resolve, reject) => {
    const p = spawn(claude, ['-p', '/usage'], { windowsHide: true, cwd: os.tmpdir(), env: { ...baseEnv, ...envFor(id) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', done = false;
    const t = setTimeout(() => { done = true; p.kill(); reject(bad('Claude did not answer in time.', 504)); }, 60000);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err = (err + d).slice(-500); });
    p.on('close', () => {
      if (done) return; clearTimeout(t);
      const u = parseUsage(out);
      if (!u) return reject(bad((err.trim().split('\n').pop() || out.trim().split('\n').pop()) || 'No usage report: is this account logged in?'));
      const all = readJson(USAGE(), {}) || {}; all[id] = u; writeJson(USAGE(), all); resolve(u);
    });
  });
}

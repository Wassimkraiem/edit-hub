// local addition: the Crew. A crew is a folder that is a plain Claude Code project: CLAUDE.md (the Director's
// instructions), .claude/agents/<id>.md (one subagent per crew member: front matter name, description, skills,
// optional tools/model; then its instructions), .claude/skills/<skill>/SKILL.md (skills only this crew uses),
// .claude/settings.json, and voice-words.txt (words that help the voice input spell your names and tools).
// The Director (terminal.js) runs Claude Code in that folder with the films workspace added. Whose crew it is is a
// setting (crewDir), so everyone keeps their own crew in their own folder or repo; a new one starts from
// crews/starter. This module only lists, reads and writes those files.
import { ID as APP_ID } from './identity.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { baseDir, config, saveConfig } from './config.js';
import { DATA_DIR } from './util.js';

const STARTER = fileURLToPath(new URL('../crews/starter', import.meta.url));
const SKILLS = () => process.env.VIDEOHUB_SKILLS_DIR || path.join(os.homedir(), '.claude', 'skills');
const agentsDir = () => path.join(crewDir(), '.claude', 'agents');
const ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const bad = msg => Object.assign(new Error(msg), { code: 400 });

// the crew folder: the crewDir setting, else <workspace>/crew; made from the starter crew when it has no CLAUDE.md
export function crewDir() {
  const dir = process.env.VIDEOHUB_CREW_DIR || config().crewDir || path.join(baseDir(), 'crew');
  if (!fs.existsSync(path.join(dir, 'CLAUDE.md'))) makeCrew(dir);
  return dir;
}
// the starter crew has no dot-names (GitHub's browser upload drops them): agents/ and skills/ become .claude/…
export function makeCrew(dir) {
  for (const [from, to] of [['CLAUDE.md', 'CLAUDE.md'], ['channel.md', 'channel.md'], ['brand.md', 'brand.md'], ['voice-words.txt', 'voice-words.txt'], ['agents', '.claude/agents'], ['skills', '.claude/skills']]) {
    const src = path.join(STARTER, from), dst = path.join(dir, to);
    if (fs.existsSync(src) && !fs.existsSync(dst)) fs.cpSync(src, dst, { recursive: true, filter: s => path.basename(s) !== '_template.md' });
  }
}
export function setCrewDir({ dir }: { dir?: any } = {}) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw bad('Give the full path of the crew folder.');
  fs.mkdirSync(dir, { recursive: true });
  saveConfig({ crewDir: dir, crews: withCurrent(dir) }); return status();
}

// several Directors, one per kind of content: each is a crew folder of its own (config crews: [{ name, dir, about }]);
// crewDir is the one in use. A new one copies the current Director's instructions (your language, your rules), adds
// what it makes, and starts with no agents: its first job is to design its own crew.
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const known = () => (config().crews || []).filter(c => c && typeof c.dir === 'string' && path.isAbsolute(c.dir));
function withCurrent(extra?: string) {   // extra: one more crew folder to list
  const list = known(), cur = process.env.VIDEOHUB_CREW_DIR || config().crewDir || path.join(baseDir(), 'crew');
  for (const d of [cur, extra].filter(Boolean)) if (!list.some(c => same(c.dir, d))) list.push({ name: path.basename(d), dir: d });
  return list;
}
// the Director of directors: a crew folder of its own (<studio>/head-director) that sees every crew folder next to it
// (the Director adds that folder with --add-dir), to organize, create and improve Directors and hand them jobs.
// Its parent is the studio folder: the folder of the first crew. Crew folders found there join the list on their own.
export const HEAD_NAME = 'Director of directors';
export const studioDir = () => path.dirname(withCurrent()[0].dir);
export const headDir = () => path.join(studioDir(), 'head-director');
export const isHead = (dir = crewDir()) => same(dir, headDir());
export function ensureHead() {
  const dir = headDir();
  if (!fs.existsSync(path.join(dir, 'CLAUDE.md'))) {
    fs.mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), fs.readFileSync(path.join(STARTER, 'HEAD.md'), 'utf8').replaceAll('{{studio}}', studioDir()).replaceAll('{{config}}', path.join(DATA_DIR, 'config.json')));
  }
  return dir;
}
// crew folders in the studio folder (a CLAUDE.md and a .claude/agents folder), other than the head's own
function found() {
  let out = []; try { out = fs.readdirSync(studioDir(), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(studioDir(), d.name)); } catch { }
  return out.filter(d => !same(d, headDir()) && fs.existsSync(path.join(d, 'CLAUDE.md')) && fs.existsSync(path.join(d, '.claude', 'agents')));
}
export function crews() {
  const cur = crewDir(), list = withCurrent();
  for (const d of found()) if (!list.some(c => same(c.dir, d))) list.push({ name: path.basename(d).replace(/-crew$/, ''), dir: d });
  const head = { name: HEAD_NAME, dir: ensureHead(), head: true };
  return [head, ...list.filter(c => !same(c.dir, head.dir))].map(c => ({ ...c, active: same(c.dir, cur) }));
}
export function useCrew({ dir }: { dir?: any } = {}) {
  const c = crews().find(x => same(x.dir, String(dir || '')));
  if (!c) throw bad('No such crew.');
  return setCrewDir({ dir: c.dir });
}
export function createCrew({ name, about }: { name?: any; about?: any } = {}) {
  name = String(name || '').trim(); about = String(about || '').trim();
  if (!name || name.length > 60) throw bad('Give the new Director a short name, e.g. Cartoon explainers.');
  if (!about) throw bad('Describe the content this Director makes.');
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'director';
  const from = crewDir(), dir = path.join(path.dirname(from), slug + '-crew');
  if (fs.existsSync(dir)) throw bad('A crew folder with that name already exists: ' + dir);
  fs.mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true });
  const base = fs.existsSync(path.join(from, 'CLAUDE.md')) ? fs.readFileSync(path.join(from, 'CLAUDE.md'), 'utf8') : fs.readFileSync(path.join(STARTER, 'CLAUDE.md'), 'utf8');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `${base.trimEnd()}\n\n## This Director: ${name}\n${about}\n\nThis is a new crew: it starts with no agents, and agents named above that are not in .claude/agents do not exist here. Your first job is to design the crew this content needs (see "Growing the crew"): decide which specialists it takes, create each one with the right skills, and tell the user the crew you built.\n`);
  for (const f of ['voice-words.txt']) if (fs.existsSync(path.join(from, f))) fs.copyFileSync(path.join(from, f), path.join(dir, f));
  for (const f of ['channel.md', 'brand.md']) fs.copyFileSync(path.join(STARTER, f), path.join(dir, f));
  const set = path.join(from, '.claude', 'settings.json'); if (fs.existsSync(set)) fs.copyFileSync(set, path.join(dir, '.claude', 'settings.json'));   // the same light settings (plugins)   // its own channel and brand, to fill
  saveConfig({ crews: [...withCurrent(), { name, dir, about }], crewDir: dir });
  return { name, dir, about };
}

// key → file; only these keys can be read or written
export function fileOf(key) {
  if (key === 'CLAUDE.md') return path.join(crewDir(), 'CLAUDE.md');
  if (key === 'voice-words.txt') return path.join(crewDir(), 'voice-words.txt');
  if (key === 'channel.md' || key === 'brand.md') return path.join(crewDir(), key);   // the channel profile and brand kit
  if (key === 'settings.json') return path.join(crewDir(), '.claude', 'settings.json');
  const m = /^agents\/(.+)\.md$/.exec(String(key));
  if (m && ID.test(m[1])) return path.join(agentsDir(), m[1] + '.md');
  throw bad('Not a crew file: ' + key);
}
export function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text); if (!m) return null;
  return Object.fromEntries(m[1].split(/\r?\n/).filter(l => l.includes(':')).map(l => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]));
}
// skills: the ones its front matter preloads; onDemand: skills it names in its instructions (loaded with the Skill tool
// when a job needs them); missing: names that are no skill of yours or of the crew, so the agent cannot load them
const mentions = (text, name) => new RegExp('(^|[^a-z0-9-])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9-])', 'i').test(text);
export function agents(dir = crewDir()) {
  const folder = path.join(dir, '.claude', 'agents');
  let names = []; try { names = fs.readdirSync(folder).filter(f => f.endsWith('.md')).sort(); } catch { }
  const known = [...new Set([...skillsIn(SKILLS()), ...skillsIn(path.join(dir, '.claude', 'skills'))])];
  return names.map(f => {
    const text = fs.readFileSync(path.join(folder, f), 'utf8'), fm = frontMatter(text) || {};
    const skills = (fm.skills || '').split(',').map(s => s.trim()).filter(Boolean), body = text.replace(/^---[\s\S]*?\n---/, '');
    return { id: f.slice(0, -3), key: 'agents/' + f, shared: fm.shared === 'true', description: fm.description || '', skills,
      onDemand: known.filter(s => !skills.includes(s) && mentions(body, s)), missing: skills.filter(s => !known.includes(s)) };
  });
}
// every skill of yours the crew's agents name goes into the Director's kit too: an agent can only load what its
// Director has (the kit page's ticks are kept as they are; these are added when the Director starts)
export function namedByAgents(dir = crewDir()) {
  const mine = skillsIn(SKILLS()), direct = [...new Set(agents(dir).flatMap(a => [...a.skills, ...a.onDemand]))].filter(s => mine.includes(s));
  // and the skills those skills point to, one level deep (the brand style finds its sounds with openverse)
  const refs = direct.flatMap(s => { let t = ''; try { t = fs.readFileSync(path.join(SKILLS(), s, 'SKILL.md'), 'utf8'); } catch { } return mine.filter(x => mentions(t, x)); });
  return [...new Set([...direct, ...refs])].sort();
}
// the skills this Director has: its own (.claude/skills in the crew folder) and the ones of yours it chose (its kit)
const skillsIn = dir => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => !d.isFile() && fs.existsSync(path.join(dir, d.name, 'SKILL.md'))).map(d => d.name); } catch { return []; } };
export function skills(dir = crewDir()) { return [...new Set([...skillsIn(path.join(dir, '.claude', 'skills')), ...kitOf(dir).skills, ...namedByAgents(dir)])].sort(); }

// ---- the kit: each Director (channel) is isolated. Claude Code runs it with --setting-sources project,local, so
// nothing of yours loads by itself (no skills of ~/.claude/skills, no MCP servers, plugins or hooks of your settings):
// it gets only its folder (CLAUDE.md, .claude/agents, .claude/skills, .claude/settings.json with its plugins) and its
// kit, .claude/videohub.json { skills: [names of your skills], mcp: [names of your MCP servers] }. VideoHub links the
// skills into a private folder (data/directors/<crew>/.claude/skills, given with --add-dir) and writes the MCP servers'
// definitions, copied from your ~/.claude.json, to data/directors/<crew>/mcp.json (--mcp-config): no links and no keys
// land in the crew folder (a git repo).
const kitFile = dir => path.join(dir, '.claude', 'videohub.json');
const userMcp = () => { try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')).mcpServers || {}; } catch { return {}; } };
export function kitOf(dir = crewDir()) {
  try { const k = JSON.parse(fs.readFileSync(kitFile(dir), 'utf8')); return { skills: Array.isArray(k.skills) ? k.skills : [], mcp: Array.isArray(k.mcp) ? k.mcp : [] }; } catch { }
  // first time: the skills its prompt, channel files and agents name, and VideoHub's own MCP server
  let text = ''; for (const n of ['CLAUDE.md', 'channel.md', 'brand.md']) { try { text += fs.readFileSync(path.join(dir, n), 'utf8'); } catch { } }
  try { for (const a of fs.readdirSync(path.join(dir, '.claude', 'agents'))) text += fs.readFileSync(path.join(dir, '.claude', 'agents', a), 'utf8'); } catch { }
  const named = skillsIn(SKILLS()).filter(s => new RegExp('(^|[^a-z0-9-])' + s + '($|[^a-z0-9-])', 'i').test(text));   // skill names are letters, digits and dashes
  const kit = { skills: [...new Set([APP_ID, ...named])].filter(s => skillsIn(SKILLS()).includes(s)).sort(), mcp: APP_ID in userMcp() ? [APP_ID] : [] };
  fs.mkdirSync(path.dirname(kitFile(dir)), { recursive: true }); fs.writeFileSync(kitFile(dir), JSON.stringify(kit, null, 2) + '\n');
  return kit;
}
// a Director's folder from the page (any of them, not only the one in use); none: the one in use
const directorDir = d => { if (!d) return crewDir(); const c = crews().find(x => same(x.dir, String(d))); if (!c) throw bad('Not a Director folder'); return c.dir; };
export function saveKit({ dir, skills: s, mcp }: { dir?: string; skills?: string[]; mcp?: string[] } = {}) {
  dir = directorDir(dir);
  const all = skillsIn(SKILLS()), servers = Object.keys(userMcp());
  if (!Array.isArray(s) || !Array.isArray(mcp)) throw bad('skills and mcp must be lists');
  const kit = { skills: [...new Set(s)].filter(x => all.includes(x)).sort(), mcp: [...new Set(mcp)].filter(x => servers.includes(x)).sort() };
  fs.mkdirSync(path.dirname(kitFile(dir)), { recursive: true }); fs.writeFileSync(kitFile(dir), JSON.stringify(kit, null, 2) + '\n'); return kitInfo({ dir });
}
export function kitInfo({ dir }: { dir?: any } = {}) { dir = directorDir(dir); return { ...kitOf(dir), allSkills: skillsIn(SKILLS()), allMcp: Object.keys(userMcp()).sort(), own: skillsIn(path.join(dir, '.claude', 'skills')) }; }
// the private folder a Director starts with: its skills linked in, its MCP servers' definitions
export function buildKit(dir = crewDir()) {
  const kit = kitOf(dir), home = path.join(DATA_DIR, 'directors', path.basename(dir).replace(/[^a-zA-Z0-9_.-]/g, '-')), links = path.join(home, '.claude', 'skills');
  fs.mkdirSync(links, { recursive: true });
  for (const n of fs.readdirSync(links)) { const p = path.join(links, n); if (fs.lstatSync(p).isSymbolicLink()) fs.rmdirSync(p); }   // the links only, never what they point to
  for (const s of new Set([...kit.skills, ...namedByAgents(dir)])) { const to = path.join(SKILLS(), s); if (fs.existsSync(path.join(to, 'SKILL.md'))) { try { fs.symlinkSync(fs.realpathSync(to), path.join(links, s), 'junction'); } catch { } } }
  const defs = userMcp(), mcpConfig = path.join(home, 'mcp.json');
  fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: Object.fromEntries(kit.mcp.filter(n => defs[n]).map(n => [n, defs[n]])) }, null, 2));
  return { addDir: home, mcpConfig };
}
// Claude Code's flags for the Director's own kit only: its folder's settings (not yours), its skills, its MCP servers
export const isolation = () => { const k = buildKit(); return ['--setting-sources', 'project,local', '--add-dir', k.addDir, '--mcp-config', k.mcpConfig]; };
// and no claude.ai connectors of your account (Gmail, Buffer…): a Director gets MCP servers from its kit only.
// Crew agents run on Sonnet unless their file names a model (model: opus for the ones that need it): without this they
// inherit the Director's Opus, and most of a conversation's tokens are spent in crew agents
export const isolationEnv = { ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' };
export function status() {
  try { syncShared(); } catch { }
  return { dir: crewDir(), workspace: baseDir(), files: ['CLAUDE.md', 'channel.md', 'brand.md', 'settings.json', 'voice-words.txt'].map(key => ({ key, path: fileOf(key), exists: fs.existsSync(fileOf(key)) })), agents: agents(), skills: skills() };
}
export function read(key) { const f = fileOf(key); return { key, path: f, text: fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '' }; }
export function write({ key, text }: { key?: any; text?: any } = {}) {
  if (typeof text !== 'string') throw bad('text must be text');
  if (key === 'settings.json' && text.trim()) { try { JSON.parse(text); } catch (e) { throw bad('settings.json is not valid JSON: ' + e.message); } }
  if (String(key).startsWith('agents/')) {
    const fm = frontMatter(text);
    if (!fm?.name || !fm.description) throw bad('An agent file starts with front matter that has at least name and description.');
  }
  const f = fileOf(key); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text);
  // a shared agent is saved to the library too, so every Director gets the change
  if (String(key).startsWith('agents/') && frontMatter(text)?.shared === 'true') { fs.mkdirSync(sharedDir(), { recursive: true }); fs.writeFileSync(path.join(sharedDir(), path.basename(f)), text); }
  return read(key);
}

// the shared library of agents (style editors, audio cleaner, analyzer…): <studio>/shared-agents/*.md, each marked
// `shared: true`. Copied into every crew's .claude/agents when the crew is shown or its Director starts; a crew's own
// agent of the same name (not marked shared) wins. Editing a shared agent from any crew saves it here too.
export const sharedDir = () => process.env.VIDEOHUB_SHARED_AGENTS || path.join(studioDir(), 'shared-agents');
export function syncShared(dir = crewDir()) {
  const src = sharedDir(); if (!fs.existsSync(src) || isHead(dir)) return 0;
  const dst = path.join(dir, '.claude', 'agents'); fs.mkdirSync(dst, { recursive: true }); let n = 0;
  for (const f of fs.readdirSync(src).filter(x => x.endsWith('.md'))) {
    const to = path.join(dst, f), text = fs.readFileSync(path.join(src, f), 'utf8');
    if (fs.existsSync(to)) { const cur = fs.readFileSync(to, 'utf8'); if (frontMatter(cur)?.shared !== 'true' || cur === text) continue; }
    fs.writeFileSync(to, text); n++;
  }
  // the studio rules (<studio>/shared-rules/*.md): written once, copied into every crew's .claude/rules
  const rules = path.join(studioDir(), 'shared-rules');
  if (fs.existsSync(rules)) {
    const out = path.join(dir, '.claude', 'rules'); fs.mkdirSync(out, { recursive: true });
    for (const f of fs.readdirSync(rules).filter(x => x.endsWith('.md'))) { const t = fs.readFileSync(path.join(rules, f), 'utf8'), to = path.join(out, f); if (!fs.existsSync(to) || fs.readFileSync(to, 'utf8') !== t) { fs.writeFileSync(to, t); n++; } }
  }
  return n;
}
// make an agent of this crew a shared one (moved to the library, marked shared)
export function shareAgent({ id }: { id?: any } = {}) {
  const key = `agents/${id}.md`, f = fileOf(key); if (!fs.existsSync(f)) throw bad('No such agent.');
  let text = fs.readFileSync(f, 'utf8');
  if (frontMatter(text)?.shared !== 'true') text = text.replace(/^---\r?\n/, '---\nshared: true\n');
  return write({ key, text });
}
export function newAgent({ id }: { id?: any } = {}) {
  if (!ID.test(String(id || ''))) throw bad('Use lowercase letters, digits and dashes for the name, e.g. devin-editor.');
  const key = `agents/${id}.md`;
  if (fs.existsSync(fileOf(key))) throw bad('That agent already exists.');
  return write({ key, text: fs.readFileSync(path.join(STARTER, 'agents', '_template.md'), 'utf8').replaceAll('{{id}}', id) });
}

export function routes(route, readBody) {
  route('GET', '/api/crew', () => status());
  route('GET', '/api/crew/file', (req, url) => read(url.searchParams.get('key')));
  route('POST', '/api/crew/file', async req => write(await readBody(req)));
  route('POST', '/api/crew/agent', async req => newAgent(await readBody(req)));
  route('POST', '/api/crew/share', async req => shareAgent(await readBody(req)));
  route('GET', '/api/crew/tools', () => toolCatalog());
  route('GET', '/api/crew/kit', (req, url) => kitInfo({ dir: url.searchParams.get('dir') }));
  route('POST', '/api/crew/kit', async req => saveKit(await readBody(req)));
  route('GET', '/api/crew/memory', (req, url) => memoryOf({ id: url.searchParams.get('id') }));
  route('POST', '/api/crew/memory', async req => saveMemory(await readBody(req)));
  route('POST', '/api/crew/dir', async req => setCrewDir(await readBody(req)));
}

// any Director's instructions (its CLAUDE.md), to read and edit without switching to it; only known Directors
function knownDir(dir) { const c = crews().find(x => same(x.dir, String(dir || ''))); if (!c) throw bad('No such Director.'); return c; }
export function instructionsOf({ dir }: { dir?: any } = {}) { const c = knownDir(dir), f = path.join(c.dir, 'CLAUDE.md'); return { ...c, path: f, text: fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '' }; }
export function saveInstructions({ dir, text }: { dir?: any; text?: any } = {}) {
  if (typeof text !== 'string') throw bad('text must be text');
  const c = knownDir(dir); fs.writeFileSync(path.join(c.dir, 'CLAUDE.md'), text); return instructionsOf({ dir: c.dir });
}

// an agent's own memory (its `memory: project` directory, written by Claude Code): .claude/agent-memory/<id>/,
// MEMORY.md first (what loads into the agent at every job), then any other notes it keeps there
const memDir = id => { if (!ID.test(String(id || ''))) throw bad('bad agent name'); return path.join(crewDir(), '.claude', 'agent-memory', id); };
export function memoryOf({ id }: { id?: any } = {}) {
  const dir = memDir(id); let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort((a, b) => Number(b === 'MEMORY.md') - Number(a === 'MEMORY.md') || a.localeCompare(b)); } catch { }
  return { id, dir, files: files.map(name => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') })) };
}
export function saveMemory({ id, name = 'MEMORY.md', text }: { id?: any; name?: any; text?: any } = {}) {
  if (typeof text !== 'string') throw bad('text must be text');
  if (!/^[\w.-]+\.md$/.test(name)) throw bad('bad file name');
  const dir = memDir(id); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), text); return memoryOf({ id });
}

// the tools an agent can be given: Claude Code's built-in tools and the MCP servers of this Director's kit (or its
// own .mcp.json); an MCP server is given as mcp__<server>
const BUILT_IN = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Skill', 'TodoWrite', 'NotebookEdit'];
export function toolCatalog() {
  const names = new Set(kitOf().mcp);
  for (const f of [path.join(crewDir(), '.mcp.json')]) {
    try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); for (const k of Object.keys(j.mcpServers || {})) names.add(k); } catch { }
  }
  return { builtIn: BUILT_IN, mcp: [...names].sort().map(n => ({ name: n, tool: 'mcp__' + n })) };
}

// @ts-nocheck
// TypeScript rewrite: not type-checked yet. Remove the line above and fix the errors to check this file.
// local addition: the Crew page. The Director is a real Claude Code terminal running in the Edit Hub workspace; the
// crew is that workspace's own Claude Code configuration (CLAUDE.md, .claude/agents, .claude/settings.json), edited
// here. The microphone types what you said into the terminal.
import { h, api, toast, onHubEvent } from './app.js';
import { Terminal } from './vendor/xterm.js';
import { FitAddon } from './vendor/addon-fit.js';
import { mountChat, usageCard } from './director-chat.js';
import { usageBars } from './usage.js';
import { md } from './md.js';

const LS = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { } } };
const MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const OLD_SERVER = 'Edit Hub\'s server is still running the old version. Close every Edit Hub window, wait two minutes, then open Edit Hub again.';
const LABEL = { 'CLAUDE.md': 'Director instructions', 'channel.md': 'Channel profile', 'brand.md': 'Brand kit', 'settings.json': 'Settings', 'voice-words.txt': 'Voice words' };
const usageText = u => { if (!u) return ''; const at = s => s ? new Date(s * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : ''; return [u.fiveHour != null && `5-hour ${u.fiveHour}%` + (u.fiveHourResets ? ` (resets ${at(u.fiveHourResets)})` : ''), u.week != null && `week ${u.week}%` + (u.weekResets ? ` (resets ${at(u.weekResets)})` : '')].filter(Boolean).join(' · '); };
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export async function crewPage(page, arg) {
  page.classList.add('cw');
  const view = arg ? decodeURIComponent(arg) : 'director';   // 'director' or a crew file key (CLAUDE.md, settings.json, agents/<id>.md)
  const side = h('nav', { class: 'cw-side', 'aria-label': 'Crew' });
  const main = h('section', { class: 'cw-main' });
  page.append(side, main);
  let crew = null;
  try { crew = await api('/api/crew'); } catch { }
  if (!crew?.files) { side.append(h('p', { class: 'cw-note cw-bad' }, OLD_SERVER)); return; }

  const link = (key, label, sub) => h('a', { class: 'cw-item' + (key === view ? ' is-on' : ''), href: '#/crew/' + encodeURIComponent(key), 'aria-current': key === view ? 'page' : null },
    h('span', { class: 'cw-item-label' }, label), sub ? h('span', { class: 'cw-when' }, sub) : null);
  // the Director's past conversations (Claude Code's transcripts), newest first
  let past = [], archived = []; try { [past, archived] = await Promise.all([api('/api/crew/history'), api('/api/crew/history?archived=1')]); } catch { }
  // each one: open to continue it; Archive hides it (Archived brings it back); Delete moves it to Edit Hub's trash folder
  const forget = async (c, how) => {
    if (how === 'delete' && !confirm(`Delete "${c.title.slice(0, 60)}"?\nIt leaves the Director's history and moves to Edit Hub's trash folder (data/trash/conversations).`)) return;
    try { await api('/api/crew/history/forget', { method: 'POST', body: { id: c.id, how } }); location.reload(); } catch (e) { toast(e.message, true); }
  };
  const act = (c, how, label) => h('button', { type: 'button', class: 'cw-hact', 'aria-label': label + ': ' + c.title, onclick: e => { e.preventDefault(); forget(c, how); } }, label);
  // an always-visible ⋯ on each conversation opens its Archive/Delete (hover still shows them too)
  const pastRow = (c, ...acts) => { const row = h('div', { class: 'cw-hrow' }, link('history/' + c.id, c.title, when(c.updated)),
    h('button', { type: 'button', class: 'cw-hmore', title: 'Archive or delete', 'aria-label': 'Archive or delete: ' + c.title, onclick: e => { e.preventDefault(); row.classList.toggle('is-open'); } }, '⋯'),
    h('span', { class: 'cw-hacts' }, ...acts)); return row; };
  const when = ms => { const d = new Date(ms), today = new Date().toDateString() === d.toDateString(); return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' }); };
  // the Directors (one crew folder per kind of content) and "New director"
  let crewList = []; try { crewList = await api('/api/crews'); } catch { }
  const crewSel = h('select', { class: 'cw-crewsel', 'aria-label': 'Which Director', onchange: () => switchCrew(crewSel.value) },
    ...(Array.isArray(crewList) ? crewList : []).map(x => h('option', { value: x.dir, selected: x.active ? '' : null, title: x.about || x.dir }, x.name)));
  crewSel.value = (Array.isArray(crewList) ? crewList : []).find(x => x.active)?.dir || '';   // show the one in use, not the first
  side.append(h('div', { class: 'cw-crews' }, crewSel, h('button', { class: 'cw-new', type: 'button', onclick: newDirector }, 'New director')));
  async function switchCrew(dir) {
    try { await api('/api/crews/use', { method: 'POST', body: { dir } }); location.hash = '#/crew'; location.reload(); } catch (e) { toast(e.message, true); }
  }
  async function newDirector() {
    const name = prompt('Name of the new Director (the kind of content), e.g. Cartoon explainers'); if (!name) return;
    const about = prompt('Describe the content it makes: format, length, style, audience, language. It designs its own crew from this.'); if (!about) return;
    try { const r = await api('/api/crews', { method: 'POST', body: { name, about } }); toast(r.name + ' is setting up its crew.'); location.hash = '#/crew'; location.reload(); } catch (e) { toast(e.message, true); }
  }
  // the crew agents with their skills; redrawn when the Director finishes something (it may have created agents)
  const agentBox = h('div', { class: 'cw-section' });
  function drawAgents(list) {
    agentBox.replaceChildren(h('p', { class: 'cw-section-name' }, `Crew agents (${list.length})`),
      // what it always loads, how many it loads when a job needs them (hover: their names), and names that are no skill
      ...list.map(a => { const el = link(a.key, a.id, ''), more = a.onDemand || [], bad = a.missing || [];
        el.title = (a.description || a.id) + (more.length ? '\n\nLoads when a job needs them: ' + more.join(', ') : '') + (bad.length ? '\n\nNot found (no such skill, so it cannot load it): ' + bad.join(', ') : '');
        el.classList.add('cw-agent');
        el.querySelector('.cw-item-label').append(h('span', { class: 'cw-agent-skills' }, (a.shared ? 'shared · ' : '') + (a.skills.length ? a.skills.join(' · ') : 'no skills yet') + (more.length ? ` + ${more.length} on demand` : '')),
          bad.length ? h('span', { class: 'cw-agent-skills cw-bad' }, 'missing: ' + bad.join(', ')) : '');
        return el; }),
      h('button', { class: 'cw-new', type: 'button', onclick: newAgent }, 'New agent'));
  }
  drawAgents(crew.agents);
  const offAgents = onHubEvent('director', async ev => { if (ev?.kind === 'result' || ev?.kind === 'exit') { try { drawAgents((await api('/api/crew')).agents); } catch { } } });
  // every Director (the Director of directors first): a click opens its instructions, in use or not
  const dirBox = h('div', { class: 'cw-section' }, h('p', { class: 'cw-section-name' }, 'Directors'),
    ...(Array.isArray(crewList) ? crewList : []).map(x => link('dir:' + x.dir, x.name, x.active ? 'in use' : x.head ? 'manages all' : '')));
  side.append(
    link('director', 'Director', ''),
    link('terminal', 'Director in a terminal', 'advanced'),
    h('div', { class: 'cw-section' }, h('p', { class: 'cw-section-name' }, 'History'),
      ...(Array.isArray(past) && past.length ? past.slice(0, 12).map(c => pastRow(c, act(c, 'archive', 'Archive'), act(c, 'delete', 'Delete'))) : [h('p', { class: 'cw-none' }, 'No past conversations yet')]),
      archived.length ? h('details', { class: 'cw-archived' }, h('summary', {}, `Archived (${archived.length})`), ...archived.map(c => pastRow(c, act(c, 'unarchive', 'Restore'), act(c, 'delete', 'Delete')))) : ''),
    agentBox,
    dirBox,
    h('div', { class: 'cw-section' }, h('p', { class: 'cw-section-name' }, 'Setup'),
      link('requirements', 'Requirements', ''),
      ...crew.files.map(f => link(f.key, LABEL[f.key], f.exists ? '' : 'not made yet'))),
    h('div', { class: 'cw-note' }, h('p', {}, 'Crew folder: ' + crew.dir), h('button', { class: 'cw-new', type: 'button', onclick: changeDir }, 'Use another crew folder')));

  async function changeDir() {
    const dir = prompt('Full path of the crew folder (a new empty folder gets the starter crew)', crew.dir);
    if (!dir || dir === crew.dir) return;
    try { await api('/api/crew/dir', { method: 'POST', body: { dir: dir.trim() } }); toast('Crew folder changed. Restart the Director to use it.'); location.hash = '#/crew'; dispatchEvent(new HashChangeEvent('hashchange')); } catch (e) { toast(e.message, true); }
  }
  async function newAgent() {
    const id = prompt('Name of the new agent (lowercase, dashes), e.g. devin-editor');
    if (!id) return;
    try { const r = await api('/api/crew/agent', { method: 'POST', body: { id: id.trim() } }); location.hash = '#/crew/' + encodeURIComponent(r.key); } catch (e) { toast(e.message, true); }
  }
  const page_ = await (view === 'director' ? directorChat(main) : view === 'terminal' ? mountDirector(main) : view === 'requirements' ? requirements(main) : view.startsWith('history/') ? pastConversation(main, view.slice(8)) : view.startsWith('dir:') ? directorPage(main, view.slice(4), crew) : editor(main, view, crew));
  return () => { offAgents(); if (typeof page_ === 'function') page_(); };
}

// ---------- the Director as a chat, with the microphone (what you say is typed into the box; optionally sent)
async function directorChat(main) {
  main.classList.add('cw-chat');
  const chat = await mountChat(main);
  const autoSend = h('input', { type: 'checkbox', id: 'cw-autosend' }); autoSend.checked = LS.get('cw-autosend') === '1';
  autoSend.onchange = () => LS.set('cw-autosend', autoSend.checked ? '1' : '0');
  // your words go into the message box first, so auto-send sends them together with any attached video
  const voice = mic(text => { chat.type(text); if (autoSend.checked) chat.send(); });
  chat.setMic(h('span', { class: 'dc-mic' }, voice.btn, voice.status, h('label', { class: 'cw-auto', for: 'cw-autosend', title: 'Send what you said without pressing Send' }, autoSend, 'auto-send')), voice.finish);
  return () => { chat.off(); voice.release(); };
}

// ---------- an agent's memory: what it saved about your preferences (loads into it at every job), to check and fix
function memorySection(id) {
  const box = h('div', { class: 'cw-mem' }, h('p', { class: 'cw-section-name' }, 'Memory (what this agent has learned)'), h('p', { class: 'cw-help' }, 'Loading…'));
  (async () => {
    let m; try { m = await api('/api/crew/memory?id=' + encodeURIComponent(id)); } catch (e) { box.lastChild.textContent = e.message; return; }
    const main = m.files.find(f => f.name === 'MEMORY.md') || { name: 'MEMORY.md', text: '' };
    const view = h('div', { class: 'md-body' }), area = h('textarea', { class: 'cw-edit', hidden: true, dir: 'auto', 'aria-label': 'Memory of ' + id });
    const edit = h('button', { type: 'button' }, 'Edit memory'), save = h('button', { class: 'primary', type: 'button', hidden: true }, 'Save memory');
    const show = () => { view.replaceChildren(main.text.trim() ? md(main.text) : h('p', { class: 'cw-help' }, 'Nothing saved yet. The agent writes here when you correct it; you can also write a preference yourself.')); };
    edit.onclick = () => { const on = area.hidden; area.hidden = !on; view.hidden = on; save.hidden = !on; edit.textContent = on ? 'Cancel' : 'Edit memory'; if (on) { area.value = main.text; area.focus(); } };
    save.onclick = async () => { try { await api('/api/crew/memory', { method: 'POST', body: { id, name: 'MEMORY.md', text: area.value } }); main.text = area.value; show(); edit.onclick(); toast('Memory saved'); } catch (e) { toast(e.message, true); } };
    show();
    box.replaceChildren(box.firstChild, view, area, h('div', { class: 'cw-perm-actions' }, edit, save),
      ...m.files.filter(f => f.name !== 'MEMORY.md').map(f => h('details', { class: 'cw-mem-file' }, h('summary', {}, f.name), h('div', { class: 'md-body' }, md(f.text)))),
      h('p', { class: 'cw-help' }, m.dir));
  })();
  return box;
}

// ---------- any Director's instructions (its prompt), read or edited without switching to it
function directorPage(main, dir, crew) {
  const q = '/api/crews/instructions?dir=' + encodeURIComponent(dir);
  let info = null;
  const use = h('button', { type: 'button', onclick: async () => { try { await api('/api/crews/use', { method: 'POST', body: { dir } }); location.hash = '#/crew'; location.reload(); } catch (e) { toast(e.message, true); } } }, 'Switch to this Director');
  return editor(main, 'CLAUDE.md', crew, {
    title: 'Director', extra: use, below: kitSection(dir),
    load: async () => { info = await api(q); main.querySelector('.cw-top h1').textContent = info.name; use.hidden = info.active; return info; },
    save: text => api('/api/crews/instructions', { method: 'POST', body: { dir, text } }),
  });
}
// what a Director loads: only the skills and MCP servers ticked here, nothing of the other channels or your other work
function kitSection(dir) {
  const box = h('section', { class: 'cw-kit' }, h('p', { class: 'cw-help' }, 'Loading its skills and tools…'));
  (async () => {
    let k; try { k = await api('/api/crew/kit?dir=' + encodeURIComponent(dir)); } catch (e) { box.replaceChildren(h('p', { class: 'cw-help cw-bad' }, e.message)); return; }
    const boxes = (all, on, kind) => all.map(n => { const c = h('input', { type: 'checkbox', value: n, 'data-kind': kind }); c.checked = on.includes(n); return h('label', { class: 'cw-tool' }, c, n); });
    const pick = kind => [...box.querySelectorAll(`input[data-kind="${kind}"]:checked`)].map(i => i.value);
    const count = h('span', {}), recount = () => { count.textContent = `${pick('skill').length} of ${k.allSkills.length} chosen`; };
    const save = h('button', { class: 'primary', type: 'button', onclick: async () => {
      try { k = await api('/api/crew/kit', { method: 'POST', body: { dir, skills: pick('skill'), mcp: pick('mcp') } }); toast('Saved: the Director loads only these from your next message.'); } catch (e) { toast(e.message, true); }
    } }, 'Save skills and tools');
    box.replaceChildren(
      h('h2', {}, 'What this Director loads'),
      h('p', { class: 'cw-help' }, 'Only what is ticked, plus its own agents and the skills in its folder' + (k.own.length ? ' (' + k.own.join(', ') + ')' : '') + '. Nothing of the other channels, your other skills, your other MCP servers or your claude.ai connectors.'),
      h('p', { class: 'cw-section-name' }, 'Skills ', count), h('div', { class: 'cw-tool-grid', onchange: recount }, ...boxes(k.allSkills, k.skills, 'skill')),
      h('p', { class: 'cw-section-name' }, 'MCP servers'), h('div', { class: 'cw-tool-grid' }, ...boxes(k.allMcp, k.mcp, 'mcp')),
      h('div', { class: 'cw-row' }, save));
    recount();
  })();
  return box;
}

// ---------- one past Director conversation: it opens in the Director chat (its history shown, your next message
// continues it there); read here only when you keep the Director on the conversation it is working on
async function continueHere(id, ask) {
  const s = await api('/api/director');
  if (s.sessionId !== id) {
    if ((s.busy ?? s.working) && ask && !confirm('The Director or its crew agents are working on another conversation. Stop them and open this one?')) return false;
    await api('/api/director/open', { method: 'POST', body: { session: id } });
  }
  location.hash = '#/crew/director'; return true;
}
async function pastConversation(main, id) {
  const resumeBtn = h('button', { class: 'primary', type: 'button', hidden: true, onclick: async () => { try { await continueHere(id, true); } catch (e) { toast(e.message, true); } } }, 'Continue it here');
  const sub = h('p', {}), thread = h('div', { class: 'cw-past' }, h('p', { class: 'cw-help' }, 'Loading…'));
  main.append(h('div', { class: 'cw-top' }, h('h1', {}, 'Past conversation'), sub, h('span', { class: 'cw-spacer' }), resumeBtn), h('div', { class: 'cw-pastwrap' }, thread));
  let c; try { c = await api('/api/crew/history/' + encodeURIComponent(id)); } catch (e) { thread.replaceChildren(h('p', { class: 'cw-help cw-bad' }, e.message)); return; }
  if (c.resumable) { try { if (await continueHere(id, true)) return; } catch (e) { toast(e.message, true); } }   // kept the running one: read it here
  resumeBtn.hidden = !c.resumable;
  sub.textContent = c.resumable ? 'Read it here, or continue it where it stopped' : 'From before the crew moved to its own folder: to read only';
  const at = t => t ? new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  thread.replaceChildren(...c.items.map(i => i.role === 'step' ? h('p', { class: 'cw-pstep' }, i.text)
    : h('div', { class: 'cw-msg cw-' + i.role, dir: 'auto' }, h('span', { class: 'cw-msg-who' }, (i.role === 'you' ? 'You' : 'Director') + (i.at ? ' · ' + at(i.at) : '')), h('div', { class: 'cw-msg-text' }, i.text))));
  if (!c.items.length) thread.replaceChildren(h('p', { class: 'cw-help' }, 'Nothing to show in this conversation.'));
}

// ---------- what the crew needs: a checklist, "Log in to Claude" and "Quick setup"
async function requirements(main) {
  const list = h('ul', { class: 'cw-checks' });
  const log = h('pre', { class: 'cw-log', hidden: true, 'aria-live': 'polite' });
  const gpu = h('p', { class: 'cw-help' });
  const setupBtn = h('button', { class: 'primary', type: 'button', onclick: setup }, 'Quick setup');
  const loginBtn = h('button', { type: 'button', onclick: login }, 'Log in to Claude');
  // Claude accounts: each with its own login; the Director runs on the one in use, and offers the others at a limit
  const acctList = h('ul', { class: 'cw-checks' });
  // the coding agent that runs the Director (Claude Code, Qwen Code, OpenCode)
  const harnessList = h('ul', { class: 'cw-checks' });
  async function loadHarness() {
    let r; try { r = await api('/api/harness'); } catch (e) { harnessList.replaceChildren(h('li', { class: 'cw-bad' }, e.message)); return; }
    harnessList.replaceChildren(...r.list.map(x => h('li', { class: x.found ? 'is-ok' : 'is-missing' }, h('strong', {}, x.label + (x.active ? ' (runs the Director)' : '')),
      h('span', {}, x.found ? 'installed' : 'not installed: ' + x.site),
      x.found && !x.active ? h('div', { class: 'cw-perm-actions' }, h('button', { type: 'button', onclick: async () => { try { await api('/api/harness', { method: 'POST', body: { id: x.id } }); toast(x.label + ' runs the Director from your next message.'); loadHarness(); } catch (e) { toast(e.message, true); } } }, 'Use for the Director')) : null)));
  }
  const harnessBox = h('div', { class: 'cw-accts' }, h('p', { class: 'cw-section-name' }, 'Coding agent'), h('p', { class: 'cw-help' }, 'Any of these can run the Director with your crew and skills. Claude Code shows each crew agent at work; the others run the same instructions. Each one needs its own sign-in (open it once in a terminal).'), harnessList);
  const acctBox = h('div', { class: 'cw-accts' }, h('p', { class: 'cw-section-name' }, 'Claude accounts'), acctList,
    h('button', { type: 'button', class: 'cw-new', onclick: addAccount }, 'Add another account'));
  async function loadAccounts() {
    acctList.replaceChildren(h('li', {}, 'Checking accounts…'));
    let a; try { a = await api('/api/accounts'); } catch (e) { acctList.replaceChildren(h('li', { class: 'cw-bad' }, e.message)); return; }
    acctList.replaceChildren(...a.accounts.map(x => h('li', { class: x.loggedIn ? 'is-ok' : 'is-missing' },
      h('strong', {}, (x.id === 'main' ? 'Main account' : x.id) + (x.id === a.active ? ' (in use)' : '')),
      h('span', {}, x.loggedIn ? (x.email || 'logged in') + (x.plan ? ' · ' + x.plan : '') : 'not logged in'),
      x.loggedIn ? usageBars(x.usage) : null,
      h('div', { class: 'cw-perm-actions' },
        x.id !== a.active && x.loggedIn ? h('button', { type: 'button', onclick: () => useAccount(x.id) }, 'Use this one') : null,
        x.loggedIn ? h('button', { type: 'button', title: 'One tiny message on the cheapest model to read the current usage', onclick: e => checkUsage(x.id, e.target) }, 'Check now') : null,
        h('button', { type: 'button', onclick: () => loginAs(x.id) }, x.loggedIn ? 'Log in again' : 'Log in'),
        x.id !== 'main' ? h('button', { type: 'button', class: 'ghost', onclick: () => removeAccount(x.id) }, 'Remove') : null))));
  }
  async function checkUsage(id, btn) { btn.disabled = true; btn.textContent = 'Checking…'; try { await api('/api/accounts/usage', { method: 'POST', body: { id } }); await loadAccounts(); } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Check now'; } }
  async function addAccount() {
    const id = prompt('A short name for the account (lowercase, e.g. second)'); if (!id) return;
    try { await api('/api/accounts', { method: 'POST', body: { id: id.trim() } }); await loadAccounts(); toast('Added. Press Log in next to it.'); } catch (e) { toast(e.message, true); }
  }
  async function useAccount(id) { try { await api('/api/accounts/use', { method: 'POST', body: { id } }); toast('The Director uses this account from its next start.'); loadAccounts(); } catch (e) { toast(e.message, true); } }
  async function removeAccount(id) { if (!confirm(`Remove the account "${id}" from Edit Hub?`)) return; try { await api('/api/accounts/remove', { method: 'POST', body: { id } }); loadAccounts(); } catch (e) { toast(e.message, true); } }
  async function loginAs(id) {
    try {
      const s = await api('/api/term'); if (s.alive) { toast('Stop the Director first (Crew > Director > Stop), then log in.', true); return; }
      await api('/api/term/login', { method: 'POST', body: { account: id } }); location.hash = '#/crew';
    } catch (e) { toast(e.message, true); }
  }
  main.append(h('div', { class: 'cw-top' }, h('h1', {}, 'Requirements'), h('p', {}, 'What the crew needs on this computer'), h('span', { class: 'cw-spacer' }),
    h('button', { type: 'button', onclick: load }, 'Check again'), loginBtn, setupBtn),
    h('div', { class: 'cw-editwrap cw-reqs' }, h('p', { class: 'cw-help' }, 'The crew runs on Claude Code with your own Claude subscription or account. The voice input runs Whisper on this computer; its model is downloaded once by Quick setup, never shipped with Edit Hub.'), h('div', {}, list, gpu), harnessBox, acctBox, log));
  loadAccounts(); loadHarness();
  async function load() {
    list.replaceChildren(h('li', {}, 'Checking…'));
    let r; try { r = await api('/api/requirements'); } catch (e) { list.replaceChildren(h('li', { class: 'cw-bad' }, e.message)); return; }
    list.replaceChildren(...r.items.map(i => h('li', { class: i.ok ? 'is-ok' : 'is-missing' }, h('strong', {}, (i.ok ? 'Ready: ' : 'Missing: ') + i.label), h('span', {}, i.detail))));
    gpu.textContent = r.gpu ? 'Graphics card: ' + r.gpu + ' (voice uses it)' : 'No NVIDIA graphics card found: voice uses the smaller model on the processor.';
    loginBtn.hidden = r.items.find(i => i.id === 'login')?.ok; setupBtn.disabled = r.running;
  }
  async function login() {
    try { await api('/api/term/login', { method: 'POST', body: {} }); location.hash = '#/crew'; } catch (e) { toast(e.message, true); }
  }
  async function setup() {
    try { log.hidden = false; log.textContent = ''; setupBtn.disabled = true; await api('/api/requirements/setup', { method: 'POST' }); } catch (e) { setupBtn.disabled = false; toast(e.message, true); }
  }
  const off = onHubEvent('setup', ev => {
    if (!ev) return; log.hidden = false;
    const line = ev.kind === 'step' ? '\n== ' + ev.label : ev.kind === 'log' ? ev.text : ev.kind === 'done' ? '\nDone.' : ev.kind === 'error' ? '\nStopped: ' + ev.text : '';
    if (line) { log.textContent = (log.textContent + line + '\n').slice(-20000); log.scrollTop = log.scrollHeight; }
    if (ev.kind === 'done' || ev.kind === 'error') load();
  });
  await load();
  return off;
}

// ---------- the Director: a real Claude Code terminal
export async function mountDirector(main) {
  main.classList.add('cw-director');
  const status = h('p', {});
  const startBtn = h('button', { class: 'primary', type: 'button', onclick: () => start(false) }, 'New conversation');
  const resumeBtn = h('button', { type: 'button', onclick: () => start(true) }, 'Continue last');
  const stopBtn = h('button', { type: 'button', onclick: () => confirm('Stop the Director? Anything it is doing stops too.') && api('/api/term/stop', { method: 'POST' }).catch(e => toast(e.message, true)) }, 'Stop');
  // which Claude account the Director runs on; a usage limit offers the other ones (accounts.js)
  const acctSel = h('select', { class: 'cw-acct', hidden: true, title: 'The Claude account the Director uses', 'aria-label': 'Claude account', onchange: () => switchTo(acctSel.value) });
  const banner = h('div', { class: 'cw-limit', hidden: true, role: 'alert' });
  let accts = [], runAccount = null;
  const label = id => id === 'main' ? 'Main account' : id;
  async function loadAccounts() {
    try { const a = await api('/api/accounts'); accts = a.accounts; acctSel.replaceChildren(...accts.map(x => h('option', { value: x.id }, label(x.id) + (x.email ? ' · ' + x.email : x.loggedIn ? '' : ' · not logged in')))); acctSel.value = runAccount || a.active; acctSel.hidden = accts.length < 2; } catch { acctSel.hidden = true; }
  }
  async function switchTo(id) {
    if (alive && !confirm(`Restart the Director on ${label(id)} and continue the same conversation?`)) { acctSel.value = runAccount; return; }
    try {
      await api('/api/accounts/use', { method: 'POST', body: { id } }); banner.hidden = true;
      if (alive) { await api('/api/term/stop', { method: 'POST' }); await new Promise(r => setTimeout(r, 1200)); await start(true); }
      runAccount = id; acctSel.value = id; toast('The Director now uses ' + label(id));
    } catch (e) { toast(e.message, true); }
  }
  function showLimit(acct) {
    const others = accts.filter(a => a.id !== acct && a.loggedIn);
    banner.replaceChildren(h('span', {}, `${label(acct || 'main')} reached its usage limit.`), ...others.map(o => h('button', { class: 'primary', type: 'button', onclick: () => switchTo(o.id) }, 'Continue on ' + label(o.id))),
      others.length ? null : h('span', {}, ' Add or log in to another account in Crew > Requirements.'));
    banner.hidden = false;
  }
  const box = h('div', { class: 'cw-term' });
  const autoSend = h('input', { type: 'checkbox', id: 'cw-autosend' }); autoSend.checked = LS.get('cw-autosend') === '1';
  autoSend.onchange = () => LS.set('cw-autosend', autoSend.checked ? '1' : '0');
  const voice = mic(text => send(text + (autoSend.checked ? '\r' : '')));
  // Code Mode (experimental): only a terminal Claude Code can run it, so the switch lives here; from the next start
  const code = h('input', { type: 'checkbox', id: 'cw-codemode' });
  code.onchange = async () => { try { const r = await api('/api/term/codemode', { method: 'POST', body: { on: code.checked } }); toast(`Code Mode ${r.codeMode ? 'on' : 'off'}${r.restart ? ': from the next start (Stop, then start again)' : ': from the next start'}. A Code Mode conversation can only be continued with Code Mode on.`); } catch (e) { code.checked = !code.checked; toast(e.message, true); } };
  api('/api/term').then(s => { code.checked = !!s.codeMode; }, () => { });
  // tokens and cost of the latest conversation in this crew folder (this terminal's, or the chat's)
  const usageHost = h('div', {});
  const usageBtn = h('button', { type: 'button', title: 'Tokens and cost of the latest conversation, the Director and each crew agent', onclick: async () => { try { usageHost.replaceChildren(usageCard(await api('/api/director/usage'))); } catch (e) { toast(e.message, true); } } }, 'Usage');
  main.append(
    h('div', { class: 'cw-top' }, h('h1', {}, 'Director'), status, h('span', { class: 'cw-spacer' }),
      h('label', { class: 'cw-auto', for: 'cw-codemode', title: 'Experimental Claude Code feature: Claude writes JavaScript that makes several tool calls in one step. Needs Claude Code 2.1.323 or later and Git for Windows. Turn off to go back to normal.' }, code, 'Code Mode (experimental)'),
      usageBtn, acctSel, resumeBtn, startBtn, stopBtn),
    usageHost,
    box,
    h('div', { class: 'cw-dock' }, banner, voice.btn, voice.status, h('span', { class: 'cw-spacer' }),
      h('label', { class: 'cw-auto', for: 'cw-autosend' }, autoSend, 'Press Enter for me after I talk'),
      h('span', { class: 'cw-hint' }, 'Shift+Tab switches mode (auto mode) · /agents lists the crew')));

  const t = new Terminal({ fontFamily: css('--font-outlier') || 'monospace', fontSize: 14, cursorBlink: true, scrollback: 5000, allowProposedApi: false,
    theme: { background: css('--color-paper'), foreground: css('--color-ink'), cursor: css('--color-accent'), selectionBackground: css('--color-rule-2') } });
  const fit = new FitAddon(); t.loadAddon(fit); t.open(box);
  let alive = false, queue = '', sending = null;
  const send = data => { queue += data; sending ||= Promise.resolve().then(async () => { const d = queue; queue = ''; sending = null; try { await api('/api/term/input', { method: 'POST', body: { data: d } }); } catch (e) { toast(e.message, true); } }); };
  t.onData(d => alive && send(d));
  const resize = () => { try { fit.fit(); } catch { } if (alive) api('/api/term/resize', { method: 'POST', body: { cols: t.cols, rows: t.rows } }).catch(() => { }); };
  const ro = new ResizeObserver(resize); ro.observe(box);
  const setAlive = on => {
    alive = on; stopBtn.hidden = !on; startBtn.hidden = resumeBtn.hidden = on; voice.btn.disabled = !on;
    status.textContent = on ? 'Claude Code is running in your Edit Hub workspace' : 'Not running: start a new conversation or continue the last one';
  };
  async function start(resume) {
    try { fit.fit(); } catch { }
    try { t.reset(); await api('/api/term/start', { method: 'POST', body: { cols: t.cols, rows: t.rows, resume } }); setAlive(true); t.focus(); } catch (e) { toast(e.message, true); }
  }
  // events first (held until the saved output is written), then the output kept so far
  let ready = false; const held = [];
  const off = onHubEvent('term', ev => { if (!ev) return; if (!ready) return held.push(ev); apply(ev); });
  function apply(ev) {
    if (ev.kind === 'data') t.write(ev.data);
    else if (ev.kind === 'start') { setAlive(true); banner.hidden = true; }
    else if (ev.kind === 'limit') { runAccount = ev.account; loadAccounts().then(() => showLimit(ev.account)); }
    else if (ev.kind === 'exit') { setAlive(false); t.write('\r\n\x1b[2m[Claude Code ended]\x1b[0m\r\n'); }
  }
  let s = null; try { s = await api('/api/term'); } catch { }
  if (!s || typeof s.output !== 'string') { status.textContent = OLD_SERVER; return () => { off(); ro.disconnect(); t.dispose(); }; }
  if (!s.claude) toast('Claude Code was not found on this computer.', true);
  runAccount = s.account || null; loadAccounts().then(() => { if (s.limit) showLimit(s.account); });
  t.write(s.output); setAlive(s.alive); ready = true; held.splice(0).forEach(apply);
  resize(); if (s.alive && main.classList.contains('cw-main')) t.focus();   // inside the editor it never takes the keys by itself (C, Space…)
  return () => { off(); ro.disconnect(); voice.release(); t.dispose(); };
}

// ---------- the microphone: record, transcribe locally (Whisper), hand back the text
function mic(onText) {
  const status = h('span', { class: 'cw-status', 'aria-live': 'polite' });
  const btn = h('button', { class: 'cw-icon cw-mic', type: 'button', title: 'Talk (click again to stop)', 'aria-label': 'Talk', 'aria-pressed': 'false', html: MIC, onclick: () => rec ? stopRec() : startRec() });
  let rec = null, stream = null, chunks = [], t0 = 0, tick = null, transcribing = null;
  // Send while you talk: stop the mic and wait until your last words are written out (they land in the message box)
  async function finish() {
    if (rec?.state === 'recording') await new Promise(res => { rec.addEventListener('stop', () => setTimeout(res, 0), { once: true }); rec.stop(); });
    await transcribing;
  }
  const setMic = on => { btn.classList.toggle('is-rec', on); btn.setAttribute('aria-pressed', String(on)); btn.setAttribute('aria-label', on ? 'Stop recording' : 'Talk'); };
  async function startRec() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { toast('This window cannot record sound. Open Edit Hub in Chrome or Edge.', true); return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { toast('The microphone is blocked or missing: ' + e.message + '. Allow it in the browser\'s site settings for 127.0.0.1.', true); return; }
    chunks = []; rec = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : {});
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = () => { transcribing = transcribe().finally(() => { transcribing = null; }); };
    async function transcribe() {
      stream.getTracks().forEach(x => x.stop()); clearInterval(tick);
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }); rec = null; setMic(false);
      if (blob.size < 2000) { status.textContent = 'Too short, try again'; return; }
      status.textContent = 'Transcribing…';
      try {
        const r = await fetch('/api/voice/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
        const j = await r.json().catch(() => null);
        if (!j) throw new Error(OLD_SERVER);
        if (!r.ok) throw new Error(j.error || r.statusText);
        status.textContent = j.text ? '' : 'Nothing heard, try again closer to the mic';
        if (j.text) onText(j.text);
      } catch (e) { status.textContent = ''; toast('Voice: ' + e.message, true); }
    }
    rec.start(); t0 = Date.now(); setMic(true);
    const show = () => { const s = Math.floor((Date.now() - t0) / 1000); status.textContent = `Listening ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}, click the mic to stop`; };
    show(); tick = setInterval(show, 500);
  }
  const stopRec = () => { if (rec?.state === 'recording') rec.stop(); };
  return { btn, status, finish, release: () => { clearInterval(tick); if (rec?.state === 'recording') { rec.onstop = null; rec.stop(); } stream?.getTracks().forEach(x => x.stop()); } };
}

// ---------- a crew file: plain text, saved as is (checked first: settings must be JSON, an agent needs front matter)
// io: another Director's instructions ({ title, load(), save(text), extra }) instead of this crew's file
async function editor(main, key, crew, io = null) {
  const agent = key.startsWith('agents/');
  const title = io?.title || (agent ? key.slice(7, -3) : LABEL[key] || key);
  const help = {
    'CLAUDE.md': 'What the Director knows and how it works. Claude Code reads this file whenever the Director starts.',
    'voice-words.txt': 'Words the voice input should spell right: your name, your tools, your styles, your language. One line, separated by commas.',
    'settings.json': 'Claude Code settings for this crew, e.g. {"permissions": {"defaultMode": "auto"}} to start in auto mode, allowed tools, environment variables.',
  }[key] || 'One crew agent: name, description (when the Director should use it) and skills in the front matter, then its instructions. Add lasting preferences under "Standing notes".';
  const area = h('textarea', { class: 'cw-edit', spellcheck: 'false', dir: 'auto', 'aria-label': title });
  const saveBtn = h('button', { class: 'primary', type: 'button', onclick: save }, 'Save');
  const where = h('p', {});
  // an agent or the Director's instructions open as a page to read (what it does, its skills, its prompt); Edit for the file
  const readable = agent || key === 'CLAUDE.md', readPane = h('div', { class: 'cw-read' });
  const shareBtn = h('button', { type: 'button', hidden: true, title: 'Move this agent to the shared library: every Director gets it, and a change made anywhere reaches all of them', onclick: async () => { try { await api('/api/crew/share', { method: 'POST', body: { id: title } }); toast('Shared with every Director'); location.reload(); } catch (e) { toast(e.message, true); } } }, 'Share with all Directors');
  const modeBtn = h('button', { type: 'button', hidden: !readable, onclick: () => setRead(editPane.hidden ? false : true) }, 'Edit');
  const editPane = h('div', { class: 'cw-editwrap' }, h('p', { class: 'cw-help' }, help, ' Restart the Director to pick up changes.'), area,
      agent ? h('div', { class: 'cw-skills' }, h('p', { class: 'cw-section-name' }, 'Your skills (click to add to this agent)'),
        h('div', { class: 'cw-chips' }, ...crew.skills.map(s => h('button', { type: 'button', class: 'cw-chip', onclick: () => addSkill(s) }, s)))) : null);
  main.append(h('div', { class: 'cw-top' }, h('h1', {}, title), where, h('span', { class: 'cw-spacer' }), io?.extra || '', shareBtn, modeBtn, saveBtn), readPane, editPane);
  function drawRead() {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(area.value), fm = {};
    if (m) for (const l of m[1].split(/\r?\n/)) { const i = l.indexOf(':'); if (i > 0) fm[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
    shareBtn.hidden = !agent || !io === false || fm.shared === 'true';
    const skills = (fm.skills || '').split(',').map(s => s.trim()).filter(Boolean), body = m ? m[2] : area.value;
    readPane.replaceChildren(
      fm.description ? h('p', { class: 'cw-read-what' }, fm.description) : '',
      agent ? h('div', { class: 'cw-read-skills' }, h('span', { class: 'cw-section-name' }, 'Skills'), ...(skills.length ? skills.map(s => h('span', { class: 'cw-chip' }, s)) : [h('span', { class: 'cw-help' }, 'none yet: Edit to add some')])) : '',
      agent ? toolSection(fm) : '',
      agent && fm.shared === 'true' ? h('p', { class: 'cw-help' }, 'Shared agent: every Director uses it, and a change here reaches all of them.') : '',
      agent ? h('p', { class: 'cw-section-name' }, 'Instructions (its prompt)') : '',
      h('div', { class: 'md-body' }, md(body)),
      agent ? memorySection(title) : '', io?.below || '');   // below: a section of the page's own (a Director's kit)
  }
  // tool access: no tools line = every tool the Director has; a list = only those (built-in tools, mcp__<server>)
  function toolSection(fm) {
    const list = (fm.tools || '').split(',').map(s => s.trim()).filter(Boolean), box = h('div', { class: 'cw-read-skills' });
    const blocked = (fm.disallowedTools || '').split(',').map(s => s.trim()).filter(Boolean);
    box.append(h('span', { class: 'cw-section-name' }, 'Tool access'), ...(list.length ? list.map(t => h('span', { class: 'cw-chip' }, t.replace(/^mcp__/, 'MCP: '))) : [h('span', { class: 'cw-help' }, 'All tools the Director has (no limit)')]),
      ...blocked.map(t => h('span', { class: 'cw-chip cw-chip-off' }, 'blocked: ' + t)), h('button', { type: 'button', class: 'cw-new', onclick: () => pickTools(list, box) }, 'Change tools'));
    return box;
  }
  async function pickTools(list, box) {
    let cat; try { cat = await api('/api/crew/tools'); } catch (e) { toast(e.message, true); return; }
    const all = h('input', { type: 'checkbox' }); all.checked = !list.length;
    const boxes = [...cat.builtIn.map(t => [t, t]), ...cat.mcp.map(m => [m.tool, 'MCP: ' + m.name])].map(([t, lab]) => { const cb = h('input', { type: 'checkbox', value: t }); cb.checked = list.includes(t) || !list.length; return h('label', { class: 'cw-tool' }, cb, lab); });
    const save = h('button', { class: 'primary', type: 'button', onclick: async () => {
      const chosen = all.checked ? [] : boxes.map(l => l.firstChild).filter(cb => cb.checked).map(cb => cb.value);
      let t = area.value.replace(/^tools:.*\r?\n/m, '');
      if (chosen.length) t = t.replace(/^---\r?\n/, m => m + 'tools: ' + chosen.join(', ') + '\n');
      area.value = t; await save(); } }, 'Save tools');
    box.replaceWith(h('div', { class: 'cw-tools' }, h('p', { class: 'cw-section-name' }, 'Tool access'), h('label', { class: 'cw-tool' }, all, 'All tools the Director has (no limit)'), h('div', { class: 'cw-tool-grid' }, ...boxes), save));
  }
  function setRead(on) { readPane.hidden = !on; editPane.hidden = on; saveBtn.hidden = on; modeBtn.textContent = on ? 'Edit' : 'Done'; if (on) drawRead(); }
  let saved = '';
  try { const r = io ? await io.load() : await api('/api/crew/file?key=' + encodeURIComponent(key)); area.value = saved = r.text; where.textContent = r.path; } catch (e) { where.textContent = e.message; saveBtn.disabled = true; }
  setRead(readable);
  function addSkill(s) {
    const m = /^(skills:[^\n]*)$/m.exec(area.value);
    if (!m) { toast('Add a "skills:" line to the front matter first.', true); return; }
    const list = m[1].slice(7).split(',').map(x => x.trim()).filter(Boolean);
    if (list.includes(s)) return;
    area.value = area.value.replace(m[1], 'skills: ' + [...list, s].join(', '));
  }
  async function save() {
    try { if (io) await io.save(area.value); else await api('/api/crew/file', { method: 'POST', body: { key, text: area.value } }); saved = area.value; toast('Saved'); if (readable) setRead(true); } catch (e) { toast(e.message, true); }
  }
  const keys = e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } };
  area.addEventListener('keydown', keys);
  const leave = e => { if (area.value !== saved) { e.preventDefault(); e.returnValue = ''; } };
  addEventListener('beforeunload', leave);
  return () => removeEventListener('beforeunload', leave);
}

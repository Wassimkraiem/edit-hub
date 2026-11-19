// @ts-nocheck
// TypeScript rewrite: not type-checked yet. Remove the line above and fix the errors to check this file.
// local addition: the Director as a chat (server/director.js runs real Claude Code underneath). On top, the crew
// board: the Director and every crew agent; when the Director hands an agent a job, a pulse runs from the Director
// to it and the agent shows what it is doing until it is done. Below, the conversation as a page: Markdown, Arabic
// right to left, select, copy and find (Ctrl+F) like any web page. Used on the Crew page and in the editor's tab.
import { h, api, toast, onHubEvent } from './app.js';
import { md, dirOf } from './md.js';
import { usageLine } from './usage.js';

const usageText = u => { if (!u) return ''; const at = s => s ? new Date(s * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : ''; return [u.fiveHour != null && `5-hour ${u.fiveHour}%` + (u.fiveHourResets ? ` (resets ${at(u.fiveHourResets)})` : ''), u.week != null && `week ${u.week}%` + (u.weekResets ? ` (resets ${at(u.weekResets)})` : '')].filter(Boolean).join(' · '); };
const label = id => id === 'main' ? 'Main account' : id;
const pretty = id => String(id || 'agent').replace(/-/g, ' ');
const usd = n => '$' + (n < 0.995 ? n.toFixed(2) : n.toFixed(n < 10 ? 2 : 0)), tok = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
// a conversation's or an agent's use (from GET /api/director/usage), in words
const USAGE_TIP = 'From Claude Code\'s logs, at API list prices. On a Claude plan this is how much of your limit was used, not a bill. Input = new + written to cache + read from cache.';
const spendText = r => `input ${tok(r.fresh + r.cacheWrite + r.cacheRead)} (new ${tok(r.fresh)} · cache write ${tok(r.cacheWrite)} · cache read ${tok(r.cacheRead)}) · output ${tok(r.output)} · ${r.priced ? '≈ ' + usd(r.cost) : 'price unknown'}${Object.keys(r.models || {}).length ? ' · ' + Object.keys(r.models).join(' + ') : ''}${r.codeMode ? ' · Code Mode' : ''}`;
export function usageCard(u) {
  const row = (name, r) => h('li', {}, h('strong', {}, name), ' ', h('span', {}, spendText(r)));
  return h('div', { class: 'dc-usagecard', title: USAGE_TIP },
    h('p', {}, h('strong', {}, `This conversation: ≈ ${usd(u.total.cost)}`), u.total.codeMode ? ' · Code Mode was on' : ''),
    h('ul', {}, row('Director', u.director), ...u.agents.map(a => row(pretty(a.agent) + (a.description ? ' — ' + a.description : ''), a)), row('Total', u.total)));
}

export async function mountChat(host, { compact = false }: { compact?: any } = {}) {
  host.classList.add('dc'); if (compact) host.classList.add('dc-compact');
  // ---- top bar: account, mode, new conversation
  const acctSel = h('select', { class: 'dc-acct', hidden: true, 'aria-label': 'Claude account', onchange: () => useAccount(acctSel.value) });
  const modeBtn = h('button', { type: 'button', class: 'dc-mode', onclick: toggleMode });
  const usageEl = h('span', { class: 'dc-usage', title: 'How much of the limits of this Claude account is used' });
  const newBtn = h('button', { type: 'button', onclick: newConversation }, 'New conversation');
  // every Claude account with its usage (like Claude's usage screen); the one in use is lit, a click switches
  const acctStrip = h('div', { class: 'dc-accts', 'aria-label': 'Claude accounts and their usage' });
  const who = h('span', { class: 'dc-who' });
  const usageBtn = h('button', { type: 'button', title: 'Tokens and cost of this conversation, the Director and each crew agent', onclick: () => showUsage() }, 'Usage');
  const top = h('div', { class: 'dc-top' }, h('h1', {}, 'Director'), who, h('span', { class: 'dc-spacer' }), acctStrip, modeBtn, usageBtn, newBtn);
  // ---- the crew board
  const board = h('div', { class: 'dc-board', 'aria-label': 'Crew at work' });
  const nodes = new Map();   // agent id → { el, step }
  const dirNode = h('div', { class: 'dc-node dc-dir' }, h('span', { class: 'dc-avatar' }, 'D'), h('span', { class: 'dc-name' }, 'Director'), h('span', { class: 'dc-step' }, 'ready'));
  const lane = h('div', { class: 'dc-lane' });
  board.append(dirNode, lane);
  function node(agent) {
    if (nodes.has(agent)) return nodes.get(agent);
    const step = h('span', { class: 'dc-step' }, 'idle');
    const el = h('div', { class: 'dc-node', 'data-agent': agent }, h('span', { class: 'dc-wire', 'aria-hidden': 'true' }), h('span', { class: 'dc-avatar' }, pretty(agent)[0].toUpperCase()), h('span', { class: 'dc-name' }, pretty(agent)), step);
    if (!compact) { el.classList.add('is-link'); el.tabIndex = 0; el.title = 'Open ' + pretty(agent) + ': its skills and instructions'; const go = () => { location.hash = '#/crew/' + encodeURIComponent('agents/' + agent + '.md'); }; el.onclick = go; el.onkeydown = e => { if (e.key === 'Enter') go(); }; }
    lane.append(el); const n = { el, step }; nodes.set(agent, n); return n;
  }
  const working = new Map(), doneIds = new Set();   // brief id → agent; briefs that finished
  let isWorking = false;
  function boardState() {
    const busyAgents = new Set(working.values());
    for (const [a, nd] of nodes) { nd.el.classList.toggle('is-working', busyAgents.has(a)); if (!busyAgents.has(a) && !['done', 'failed', 'stopped'].includes(nd.step.textContent)) nd.step.textContent = 'idle'; }
    const n = busyAgents.size, agentsText = `${n} crew agent${n > 1 ? 's' : ''} working`;
    dirNode.classList.toggle('is-working', isWorking);
    dirNode.querySelector('.dc-step').textContent = isWorking ? (n ? `directing ${n} agent${n > 1 ? 's' : ''}` : 'thinking…') : n ? `waiting · ${agentsText}` : 'ready';
    // the line by the message box always says who is still at work; Stop stops the Director and its crew agents
    stopBtn.hidden = !(isWorking || n);
    status.textContent = isWorking ? 'The Director is working…' : n ? `${agentsText} in the background (you can keep talking)` : '';
  }
  // ---- the conversation
  const thread = h('div', { class: 'dc-thread', role: 'log', 'aria-live': 'polite' });
  const log = h('div', { class: 'dc-log' }, thread);
  const banner = h('div', { class: 'dc-banner', hidden: true, role: 'alert' });
  const input = h('textarea', { rows: 1, dir: 'auto', placeholder: 'Talk or type to the Director (/ for skills and commands)', 'aria-label': 'Message to the Director', 'aria-autocomplete': 'list', oninput: () => { grow(); input.dir = dirOf(input.value); slash(); }, onkeydown: e => { if (slashKey(e)) return; if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } } });
  // "/" at the start of the box lists the skills and commands this Director really has (what Claude Code announced),
  // like in the Claude Code app; picking one writes it, the Director runs it when the message is sent
  let commands = [], picks = [], sel = 0;
  const menu = h('ul', { class: 'dc-slash', role: 'listbox', 'aria-label': 'Skills and commands', hidden: true });
  function slash() {
    const m = /^\/([\w:.-]*)$/.exec(input.value), q = m?.[1].toLowerCase();
    picks = m ? commands.filter(c => c.toLowerCase().includes(q)).sort((a, b) => a.toLowerCase().indexOf(q) - b.toLowerCase().indexOf(q) || a.localeCompare(b)).slice(0, 8) : [];
    sel = 0; menu.hidden = !picks.length; drawMenu();
  }
  const drawMenu = () => menu.replaceChildren(...picks.map((c, i) => h('li', { role: 'option', class: i === sel ? 'is-on' : '', 'aria-selected': String(i === sel), onmousedown: e => { e.preventDefault(); pick(c); } }, '/' + c)));
  const pick = c => { input.value = '/' + c + ' '; menu.hidden = true; picks = []; grow(); input.focus(); };
  function slashKey(e) {
    if (menu.hidden || !picks.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { sel = (sel + (e.key === 'ArrowDown' ? 1 : picks.length - 1)) % picks.length; drawMenu(); }
    else if (e.key === 'Enter' || e.key === 'Tab') pick(picks[sel]);
    else if (e.key === 'Escape') menu.hidden = true;
    else return false;
    e.preventDefault(); return true;
  }
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; };
  const sendBtn = h('button', { class: 'primary', type: 'button', onclick: () => send() }, 'Send');
  const stopBtn = h('button', { type: 'button', hidden: true, onclick: () => api('/api/director/stop', { method: 'POST' }).catch(e => toast(e.message, true)) }, 'Stop');
  const micHost = h('span', {});
  const status = h('span', { class: 'dc-status', 'aria-live': 'polite' });
  // attach files (a video to edit…): each is copied into the workspace inbox and its path added to your message
  const picker = h('input', { type: 'file', multiple: '', hidden: true, accept: 'video/*,audio/*,image/*', onchange: () => { attachFiles(picker.files); picker.value = ''; } });
  const attachBtn = h('button', { type: 'button', title: 'Attach videos, sounds or pictures (or drop them on the message box)', onclick: () => picker.click() }, 'Attach');
  function attachFiles(files) { const p = (attaching || Promise.resolve()).then(() => attachEach([...files])); attaching = p; p.finally(() => { if (attaching === p) attaching = null; }); return p; }
  async function attachEach(files) {
    for (const f of files) {
      status.textContent = `Attaching ${f.name}…`; attachBtn.disabled = true;
      try {
        const r = await fetch('/api/director/attach?name=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f });
        const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText);
        input.value = (input.value.trim() ? input.value.trimEnd() + '\n' : '') + `Attached: ${j.path}`; input.dir = dirOf(input.value); grow();
      } catch (e) { toast(`${f.name} could not be attached: ${e.message}`, true); }
    }
    boardState(); attachBtn.disabled = false; input.focus();
  }
  const box = h('div', { class: 'dc-box' }, menu, input, h('div', { class: 'dc-row' }, micHost, attachBtn, picker, status, h('span', { class: 'dc-spacer' }), stopBtn, sendBtn));
  box.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); box.classList.add('is-drop'); } });
  box.addEventListener('dragleave', () => box.classList.remove('is-drop'));
  box.addEventListener('drop', e => { if (!e.dataTransfer?.files.length) return; e.preventDefault(); box.classList.remove('is-drop'); attachFiles(e.dataTransfer.files); });
  host.append(top, board, log, h('div', { class: 'dc-dock' }, banner, box));
  // the conversation follows the newest message (results land in view) unless you scrolled up to read; back at the
  // bottom, it follows again
  let stick = true;
  const scroll = () => { if (stick) log.scrollTop = log.scrollHeight; };
  log.addEventListener('scroll', () => { stick = log.scrollHeight - log.clientHeight - log.scrollTop < 60; });
  const follow = new ResizeObserver(() => scroll()); follow.observe(thread);

  let typing = null, accts = [], runAccount = null, harnessId = null;
  const briefCards = new Map();
  function setWorking(on) { isWorking = on; boardState(); }
  // a brief card's state, said in words on the card and on the agent's node
  const STATE = { working: 'working…', background: 'working in the background…', completed: 'done', failed: 'failed', killed: 'stopped', stopped: 'stopped' };
  function markBrief(b, state, text) {
    b.card.classList.toggle('is-working', state === 'working' || state === 'background');
    b.card.classList.toggle('is-done', state === 'completed'); b.card.classList.toggle('is-failed', !['working', 'background', 'completed'].includes(state));
    b.state.textContent = STATE[state] || state; b.agentN.step.textContent = STATE[state] || state;
    if (text !== undefined) { b.result.hidden = !text; b.result.replaceChildren(md(text)); }
  }
  const replyEl = text => { const el = h('div', { class: 'dc-reply md-body' }); el.append(md(text)); return el; };
  const stepEl = (text, cls = '') => h('p', { class: 'dc-stepline ' + cls, dir: dirOf(text) }, text);
  // what a reply cost, per model (claude-opus-5-5 → opus): the crew agents' work is included
  // tokens and cost from Claude Code's own logs (server/usage.js): per crew agent when it finishes, and per conversation
  let curSession = null;
  async function agentUsage(b, agentId) {
    if (!agentId || !curSession || b.usage) return;
    try { const r = await api(`/api/director/usage?session=${encodeURIComponent(curSession)}&agent=${encodeURIComponent(agentId)}`); b.usage = h('p', { class: 'dc-usage', title: USAGE_TIP }, 'Used: ' + spendText(r)); b.card.append(b.usage); } catch { }
  }
  async function showUsage() {
    let u; try { u = await api('/api/director/usage' + (curSession ? '?session=' + encodeURIComponent(curSession) : '')); } catch (e) { toast(e.message, true); return; }
    thread.append(usageCard(u)); scroll();
  }
  const costLine = ev => { const r = ev.reply, by = Object.entries((r || ev).models || {}).map(([m, v]) => `${(/claude-([a-z]+)/.exec(m) || [, m])[1]} ${tok(v.tokens)}`).join(', ');
    const el = stepEl((r ? `This reply ≈ ${usd(r.cost)}${by ? ` (${by} tokens)` : ''} · conversation ≈ ${usd(ev.cost)}` : `Conversation so far ≈ ${usd(ev.cost)}${by ? ` (${by} tokens)` : ''}`), 'is-cost');
    el.title = 'Estimated at API prices by Claude Code, crew agents included. On a Claude plan this is usage, not a bill.'; return el; };
  // the Director's working steps (and any it was refused) fold into one closed line per stretch of work: only the
  // results show (its words, the briefs and what came back); the line opens on a click for the details
  function addStep(parent, text, cls = '') {
    let g = parent.lastElementChild;
    if (!g?.classList?.contains('dc-steps')) { g = h('details', { class: 'dc-steps' }, h('summary', {}, ''), h('ol', {})); parent.append(g); }
    const ol = g.querySelector('ol'); ol.append(h('li', { class: cls, dir: dirOf(text) }, text));
    const n = ol.children.length; g.querySelector('summary').textContent = `${n} step${n > 1 ? 's' : ''}`;
  }
  function briefCard(ev) {
    const agentN = node(ev.agent);
    const steps = h('ol', { class: 'dc-substeps' }), result = h('div', { class: 'dc-result md-body', hidden: true }), state = h('span', { class: 'dc-bstate' }, 'working…');
    const card = h('details', { class: 'dc-brief is-working', open: true },
      h('summary', {}, h('span', { class: 'dc-pill' }, 'Director → ' + pretty(ev.agent)), h('span', { dir: dirOf(ev.description || '') }, ev.description || 'a job'), state),
      ev.prompt ? h('details', { class: 'dc-prompt' }, h('summary', {}, 'The brief'), h('div', { class: 'md-body' }, md(ev.prompt))) : '', steps, result);
    thread.append(card); const b = { card, steps, result, agentN, state }; briefCards.set(ev.id, b);
    working.set(ev.id, ev.agent); markBrief(b, 'working');
    agentN.el.classList.remove('is-pulse'); void agentN.el.offsetWidth; agentN.el.classList.add('is-pulse');   // the pulse runs again
    boardState();
  }
  function apply(ev, live = true) {
    if (ev.kind === 'delta') { if (!typing) { typing = h('div', { class: 'dc-reply dc-typing', dir: 'auto' }); thread.append(typing); } typing.textContent += ev.text; typing.dir = dirOf(typing.textContent); if (live) scroll(); return; }
    if (ev.kind === 'text') { typing?.remove(); typing = null; thread.append(replyEl(ev.text)); }
    else if (ev.kind === 'user') { thread.querySelector('.dc-welcome')?.remove(); thread.append(h('div', { class: 'dc-you', dir: dirOf(ev.text) }, ev.text)); setWorking(true); }
    else if (ev.kind === 'tool') addStep(thread, ev.name.replace(/^mcp__\w+__/, '') + (ev.text ? ': ' + ev.text : ''));
    else if (ev.kind === 'toolError') addStep(thread, 'Refused, then retried: ' + ev.text, 'is-bad');
    else if (ev.kind === 'brief') briefCard(ev);
    else if (ev.kind === 'sub') {
      // an agent started before this page (or Edit Hub) knew it, continued by the Director: it still gets a card
      if (!briefCards.has(ev.parent)) briefCard({ id: ev.parent, agent: ev.agent || 'crew-agent', description: 'Continued work' });
      const b = briefCards.get(ev.parent), line = ev.what === 'tool' ? `${ev.name.replace(/^mcp__\w+__/, '')}${ev.text ? ': ' + ev.text : ''}` : ev.text;
      if (!working.has(ev.parent) && !doneIds.has(ev.parent)) { working.set(ev.parent, ev.agent || 'crew-agent'); markBrief(b, 'working'); boardState(); }   // a late step does not re-open a finished agent
      b.steps.append(h('li', { dir: dirOf(line) }, line)); if (b.steps.children.length > 40) b.steps.firstChild.remove(); b.agentN.step.textContent = line.slice(0, 60);
    }
    else if (ev.kind === 'briefBackground' || ev.kind === 'briefResume') {
      if (!briefCards.has(ev.id)) briefCard({ id: ev.id, agent: ev.agent || 'crew-agent', description: ev.text || 'Continued work' });
      const b = briefCards.get(ev.id); doneIds.delete(ev.id); working.set(ev.id, ev.agent || 'crew-agent'); markBrief(b, 'background'); boardState();
    }
    else if (ev.kind === 'briefDone') {
      const b = briefCards.get(ev.id); working.delete(ev.id); doneIds.add(ev.id);
      if (b) { markBrief(b, ev.status || (ev.ok ? 'completed' : 'failed'), ev.text || ''); b.card.open = !ev.ok; b.agentN.el.classList.add('is-done'); setTimeout(() => b.agentN.el.classList.remove('is-done'), 4000); agentUsage(b, ev.agentId); }
      boardState();
    }
    else if (ev.kind === 'permission') {
      const actions = h('div', { class: 'dc-row' }, h('button', { class: 'primary', type: 'button', onclick: () => answer(ev.requestId, true) }, 'Allow'), h('button', { type: 'button', onclick: () => answer(ev.requestId, false) }, 'Deny'));
      thread.append(h('div', { class: 'dc-perm', 'data-req': ev.requestId }, h('p', {}, h('strong', {}, 'Allow ' + ev.name.replace(/^mcp__\w+__/, '') + '?'), ' ', ev.text), ev.detail ? h('code', {}, ev.detail) : '', actions));
    }
    else if (ev.kind === 'answered') thread.querySelector(`[data-req="${CSS.escape(ev.requestId)}"] .dc-row`)?.replaceWith(h('p', { class: ev.allow ? 'dc-ok' : 'dc-no' }, ev.allow ? 'Allowed' : 'Denied'));
    else if (ev.kind === 'result') { refreshAgents(); typing?.remove(); typing = null; setWorking(false); /* crew agents in the background keep working */ if (!ev.ok && ev.text) thread.append(stepEl('Stopped: ' + ev.text, 'is-bad')); if (ev.cost) thread.append(costLine(ev)); }
    else if (ev.kind === 'session') { if (ev.commands) commands = ev.commands; if (ev.sessionId) curSession = ev.sessionId; }
    else if (ev.kind === 'usage') { const x = accts.find(a => a.id === ev.account); if (x) { x.usage = ev.usage; drawAccounts(); } }
    else if (ev.kind === 'limit') { runAccount = ev.account; loadAccounts().then(() => showLimit(ev.account)); }
    else if (ev.kind === 'exit') {   // the Director's process ended: its crew agents ended with it, and the cards say so
      typing?.remove(); typing = null;
      for (const id of working.keys()) { const b = briefCards.get(id); if (b) markBrief(b, 'stopped', 'Stopped: the Director closed before this agent finished (Stop, a restart of Edit Hub, or an error). Ask the Director to continue it.'); }
      working.clear(); setWorking(false); if (ev.error) thread.append(stepEl(ev.error, 'is-bad'));
    }
    else if (ev.kind === 'new' || ev.kind === 'opened') { curSession = ev.sessionId || null; thread.replaceChildren(); working.clear(); boardState(); if (ev.kind === 'opened' && live) loadPast(ev.sessionId); }
    if (live) scroll();
  }
  async function answer(requestId, allow) { try { await api('/api/director/permission', { method: 'POST', body: { requestId, allow } }); } catch (e) { toast(e.message, true); } }
  // Send = the whole message box, sent once: first the words you are still saying (the mic stops and its text lands in
  // the box) and the files still being attached, so your words and the video always leave together
  let micFinish = null, attaching = null, sending = false;
  async function send(text) {
    if (text === undefined) {
      if (sending) return; sending = true;
      try { if (micFinish || attaching) status.textContent = 'Finishing your words and attachments…'; await micFinish?.(); await attaching; }
      finally { sending = false; boardState(); }
      text = input.value;
    }
    text = String(text).trim(); if (!text) return;
    try { await api('/api/director/say', { method: 'POST', body: { text } }); if (text === input.value.trim()) { input.value = ''; grow(); } } catch (e) { toast(e.message, true); }
  }
  async function newConversation() { if (isWorking && !confirm('The Director is working. Stop and start a new conversation?')) return; try { await api('/api/director/new', { method: 'POST' }); input.focus(); } catch (e) { toast(e.message, true); } }
  // the earlier part of the conversation, from Claude Code's transcript
  async function loadPast(id, before) {
    if (!id) return;
    let c; try { c = await api('/api/crew/history/' + encodeURIComponent(id)); } catch { return; }
    const frag = document.createDocumentFragment();
    const items = c.items.filter(i => !before || !i.at || Date.parse(i.at) < before);
    for (const i of items) i.role === 'step' ? addStep(frag, i.text) : frag.append(i.role === 'you' ? h('div', { class: 'dc-you', dir: dirOf(i.text) }, i.text) : replyEl(i.text));
    if (items.length) frag.append(h('p', { class: 'dc-divider' }, 'Earlier in this conversation'));
    thread.querySelector('.dc-welcome')?.remove();
    thread.prepend(frag); scroll();
  }
  // ---- accounts and mode
  async function loadAccounts() {
    try { const a = await api('/api/accounts'); accts = a.accounts; acctSel.replaceChildren(...accts.map(x => h('option', { value: x.id }, label(x.id) + (x.email ? ' · ' + x.email : x.loggedIn ? '' : ' · not logged in')))); acctSel.value = runAccount || a.active; activeAcct = runAccount || a.active; drawAccounts(); autoCheck(); } catch { }
  }
  let activeAcct = null, autoChecked = false;
  function drawAccounts() {
    if (harnessId && harnessId !== 'claude') { acctStrip.replaceChildren(); return; }
    const shown = accts.filter(x => x.loggedIn);
    acctStrip.replaceChildren(...shown.map(x => h('button', { type: 'button', class: 'dc-acct-card' + (x.id === activeAcct ? ' is-on' : ''), title: (x.email ? x.email + ' · ' : '') + (x.id === activeAcct ? 'the Director uses this account' : 'click to use this account for the Director'), onclick: () => x.id !== activeAcct && useAccount(x.id) },
      h('span', { class: 'dc-acct-name' }, label(x.id) + (x.id === activeAcct ? ' · in use' : '')), usageLine(x.usage))),
      shown.length ? h('button', { type: 'button', class: 'dc-acct-refresh', title: 'Check the usage of every account now', 'aria-label': 'Check usage now', onclick: () => checkAll(true) }, '↻') : '');
  }
  async function checkAll(all) {
    for (const x of accts.filter(x => x.loggedIn && (all || !x.usage))) { try { x.usage = await api('/api/accounts/usage', { method: 'POST', body: { id: x.id } }); } catch { } drawAccounts(); }
  }
  function autoCheck() { if (autoChecked) return; autoChecked = true; checkAll(false); }   // accounts never checked, once per visit
  setInterval(() => acctStrip.isConnected && drawAccounts(), 60000);   // the countdowns
  async function useAccount(id) {
    try { await api('/api/accounts/use', { method: 'POST', body: { id } }); await api('/api/director/stop', { method: 'POST' }); banner.hidden = true; runAccount = id; activeAcct = id; acctSel.value = id; drawAccounts(); toast('The Director continues on ' + label(id) + ' with your next message.'); } catch (e) { toast(e.message, true); }
  }
  function showLimit(acct) {
    const others = accts.filter(a => a.id !== acct && a.loggedIn);
    banner.replaceChildren(h('span', {}, `${label(acct || 'main')} reached its usage limit.`), ...others.map(o => h('button', { class: 'primary', type: 'button', onclick: async () => { await useAccount(o.id); send('Continue where you stopped.'); } }, 'Continue on ' + label(o.id))),
      others.length ? '' : h('span', {}, ' Add or log in to another account in Crew > Requirements.'));
    banner.hidden = false;
  }
  let mode = 'auto';
  const showMode = () => { modeBtn.textContent = mode === 'auto' ? 'Auto mode' : 'Ask before commands'; modeBtn.classList.toggle('is-auto', mode === 'auto'); modeBtn.title = mode === 'auto' ? 'Claude Code decides with its own safety check; click to be asked first' : 'Edits go ahead, commands ask you; click for auto mode'; };
  async function toggleMode() { try { const r = await api('/api/director/mode', { method: 'POST', body: { mode: mode === 'auto' ? 'acceptEdits' : 'auto' } }); mode = r.mode; showMode(); if (r.restart) { await api('/api/director/stop', { method: 'POST' }); toast('From your next message.'); } } catch (e) { toast(e.message, true); } }

  // ---- start: the crew, the state, the past, the live events (agents the Director creates join the board)
  async function refreshAgents() { try { const crew = await api('/api/crew'); for (const a of crew.agents || []) node(a.id); } catch { } }
  await refreshAgents();
  let held = [], ready = false;
  const off = onHubEvent('director', ev => { if (!ev) return; if (!ready) held.push(ev); else apply(ev); });
  let s; try { s = await api('/api/director'); } catch (e) { thread.append(stepEl('The Director could not load: ' + e.message, 'is-bad')); }
  if (s && Array.isArray(s.events)) {
    mode = s.mode; showMode(); runAccount = s.account; loadAccounts(); who.textContent = s.harnessLabel ? 'on ' + s.harnessLabel : ''; harnessId = s.harness; if (s.harness && s.harness !== 'claude') acctSel.remove();
    const replay = s.events;
    for (const ev of replay) apply(ev, false);   // first: an "opened" in the replay clears the thread
    if (s.sessionId) await loadPast(s.sessionId, replay.find(e => e.kind === 'user')?.at);   // then the transcript before what the replay shows
    const last = replay.at(-1)?.seq || 0; ready = true; held.filter(e => e.seq > last).forEach(e => apply(e)); held = [];
    setWorking(!!s.working); commands = s.commands || []; curSession = s.sessionId || null;
    if (!thread.childNodes.length) thread.append(h('div', { class: 'dc-welcome' }, h('h2', {}, 'What are we making?'), h('p', {}, 'Give the Director a video link to analyze, a recording to clean, or an idea for a reel. You see each crew agent work above.')));
  } else if (s) thread.append(stepEl('Edit Hub\'s server is still running the old version: close Edit Hub and open it again.', 'is-bad'));
  scroll();
  return { off: () => { off(); follow.disconnect(); }, setMic: (el, finish) => { micHost.replaceChildren(el); micFinish = finish || null; }, type: text => { const cur = input.value.trim(); input.value = (cur ? cur + (/^Attached: .*$/m.test(cur.split('\n').pop()) ? '\n' : ' ') : '') + text; input.dir = dirOf(input.value); grow(); input.focus(); }, send };
}

// @ts-nocheck
// TypeScript rewrite: not type-checked yet. Remove the line above and fix the errors to check this file.
// local addition: the Scripts page. Every script the crew wrote, newest first, each with the video it came from
// (name, author, link, contact sheet). Read it as a page (Arabic right to left, tables, copy and find like any web
// page), switch to the original video's transcript, edit and save, or ask the Director about it.
import { h, api, toast } from './app.js';
import { md, dirOf } from './md.js';
import { sendToDirector } from './agent.js';

const when = ms => new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const mmss = s => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';

export async function scriptsPage(page, arg) {
  page.classList.add('sp');
  const sel = arg ? decodeURIComponent(arg) : null;
  const side = h('nav', { class: 'sp-side', 'aria-label': 'Scripts' }), main = h('section', { class: 'sp-main' });
  page.append(side, main);
  let all; try { all = await api('/api/scripts'); } catch (e) { side.append(h('p', { class: 'sp-note cw-bad' }, 'Scripts could not load: ' + e.message)); return; }
  if (!Array.isArray(all)) { side.append(h('p', { class: 'sp-note cw-bad' }, 'Edit Hub\'s server is still running the old version: close Edit Hub and open it again.')); return; }
  const pic = (s, name) => '/api/script/picture?id=' + encodeURIComponent(s.id) + '&name=' + encodeURIComponent(name);
  side.append(h('h1', {}, 'Scripts'), ...(all.length ? all.map(s => h('a', { class: 'sp-item' + (s.id === sel ? ' is-on' : ''), href: '#/scripts/' + encodeURIComponent(s.id), 'aria-current': s.id === sel ? 'page' : null },
    s.cover ? h('img', { src: pic(s, s.cover), alt: '', loading: 'lazy' }) : h('span', { class: 'sp-noimg' }),
    h('span', { class: 'sp-item-text' }, h('strong', { dir: dirOf(s.title) }, s.title), h('span', {}, [s.video?.author, when(s.updated)].filter(Boolean).join(' · ')))))
    : [h('p', { class: 'sp-note' }, 'No scripts yet. Ask the Director: "analyze this video and write me the script", and it lands here.')]));
  const cur = sel || all[0]?.id;
  if (!cur) { main.append(h('div', { class: 'sp-empty' }, h('p', {}, 'Scripts the crew writes show up here, each with the video it came from.'))); return; }
  let s; try { s = await api('/api/script?id=' + encodeURIComponent(cur)); } catch (e) { main.append(h('p', { class: 'sp-note cw-bad' }, e.message)); return; }

  const body = h('article', { class: 'sp-doc md-body' });
  const tabs = h('div', { class: 'sp-tabs', role: 'tablist' });
  let mode = 'script', saved = s.text;
  const area = h('textarea', { class: 'sp-edit', dir: 'auto', spellcheck: 'false', 'aria-label': 'Script text' });
  function show(m) {
    mode = m; for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.m === m));
    if (m === 'script') body.replaceChildren(md(s.text));
    else if (m === 'transcript') body.replaceChildren(s.transcript ? md(s.transcript) : h('p', {}, 'No transcript for this script.'));
    else { area.value = s.text; area.dir = dirOf(s.text); body.replaceChildren(area, h('div', { class: 'sp-row' }, h('button', { class: 'primary', type: 'button', onclick: save }, 'Save'), h('span', { class: 'sp-hint' }, 'Ctrl+S saves'))); area.focus(); }
  }
  async function save() { try { s = await api('/api/script', { method: 'POST', body: { id: s.id, text: area.value } }); saved = s.text; toast('Saved'); show('script'); } catch (e) { toast(e.message, true); } }
  area.addEventListener('input', () => { area.dir = dirOf(area.value); });
  area.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } });
  for (const [m, label] of [['script', 'Script'], ['transcript', 'Original transcript'], ['edit', 'Edit']])
    tabs.append(h('button', { type: 'button', role: 'tab', 'data-m': m, onclick: () => show(m) }, label));
  const ask = h('input', { type: 'text', dir: 'auto', placeholder: 'Ask the Director about this script (e.g. "make line 7 shorter")', 'aria-label': 'Message to the Director' });
  const askBtn = h('button', { type: 'button', onclick: async () => {
    if (!ask.value.trim()) return;
    try { toast(await sendToDirector(`[Edit Hub script] ${s.path}\n${ask.value.trim()}`)); ask.value = ''; } catch (e) { toast(e.message, true); }
  } }, 'Send to Director');
  ask.addEventListener('keydown', e => { if (e.key === 'Enter') askBtn.click(); });
  ask.addEventListener('input', () => { ask.dir = dirOf(ask.value); });
  const v = s.video, heading = (s.text.match(/^#\s+(.+)$/m) || [, s.id])[1];
  main.append(
    h('header', { class: 'sp-head' },
      s.cover ? h('img', { class: 'sp-cover', src: pic(s, s.cover), alt: 'Frames of the original video' }) : null,
      h('div', { class: 'sp-meta' },
        h('h2', { dir: dirOf(heading) }, heading),
        v ? h('p', {}, [v.author && '@' + v.author, mmss(v.duration), v.date && v.date.replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3')].filter(Boolean).join(' · '), ' ', v.url ? h('a', { href: v.url, target: '_blank', rel: 'noopener' }, 'Original video') : null) : h('p', {}, 'No video for this script'),
        h('p', { class: 'sp-path' }, s.path),
        h('div', { class: 'sp-row' }, h('button', { type: 'button', onclick: () => navigator.clipboard.writeText(s.text).then(() => toast('Script copied'), () => toast('Could not copy', true)) }, 'Copy script')))),
    tabs, body, h('div', { class: 'sp-ask' }, ask, askBtn));
  show('script');
  const leave = e => { if (mode === 'edit' && area.value !== saved) { e.preventDefault(); e.returnValue = ''; } };
  addEventListener('beforeunload', leave);
  return () => removeEventListener('beforeunload', leave);
}

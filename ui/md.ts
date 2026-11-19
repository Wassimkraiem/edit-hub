// local addition: a small, safe Markdown renderer (DOM nodes, never HTML strings) for scripts and the Director's
// replies: headings, paragraphs, lists, tables, quotes, code blocks, **bold**, *italic*, `code`, [links](https://…).
// Every block gets dir="auto", so Arabic, Darija and mixed lines read right to left where they should.
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids); return e; };
const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/;
export function inline(text) {
  const out = []; let rest = String(text), m;
  while ((m = INLINE.exec(rest))) {
    if (m.index) out.push(rest.slice(0, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(el('strong', {}, ...inline(t.slice(2, -2))));
    else if (t.startsWith('`')) out.push(el('code', {}, t.slice(1, -1)));
    else if (t.startsWith('[')) { const [, label, href] = /^\[([^\]]+)\]\((.+)\)$/.exec(t); out.push(el('a', { href, target: '_blank', rel: 'noopener' }, label)); }
    else out.push(el('em', {}, ...inline(t.slice(1, -1))));
    rest = rest.slice(m.index + t.length);
  }
  if (rest) out.push(rest);
  return out;
}
// any block with Arabic in it (Arabic, Darija, or Arabic mixed with English) reads from the right, even when it starts
// with a Latin word ("Hooks … هذا اسمو"); dir=auto would take the first letter and lay it out left to right
const AR = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
export function dirOf(text) { return AR.test(String(text)) ? 'rtl' : 'auto'; }
const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
export function md(src) {
  const frag = document.createDocumentFragment(), L = String(src).replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < L.length;) {
    const line = L[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) { const body = []; i++; while (i < L.length && !/^```/.test(L[i])) body.push(L[i++]); i++; frag.append(el('pre', { dir: 'auto' }, el('code', {}, body.join('\n')))); continue; }
    const hd = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hd) { frag.append(el('h' + Math.min(6, hd[1].length + 1), { dir: dirOf(hd[2]) }, ...inline(hd[2]))); i++; continue; }
    if (/^\s*\|/.test(line) && i + 1 < L.length && /^\s*\|?\s*:?-{2,}/.test(L[i + 1])) {   // a table: header, rule, rows
      const head = cells(line); i += 2; const rows = [];
      while (i < L.length && /^\s*\|/.test(L[i])) rows.push(cells(L[i++]));
      frag.append(el('div', { class: 'md-table' }, el('table', {}, el('thead', {}, el('tr', {}, ...head.map(c => el('th', { dir: dirOf(c) }, ...inline(c))))),
        el('tbody', {}, ...rows.map(r => el('tr', {}, ...r.map(c => el('td', { dir: dirOf(c) }, ...inline(c)))))))));
      continue;
    }
    if (/^\s*>/.test(line)) { const q = []; while (i < L.length && /^\s*>/.test(L[i])) q.push(L[i++].replace(/^\s*>\s?/, '')); frag.append(el('blockquote', { dir: dirOf(q.join(' ')) }, ...inline(q.join(' ')))); continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line), items = [];
      while (i < L.length && /^\s*([-*]|\d+\.)\s+/.test(L[i])) items.push(L[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      frag.append(el(ordered ? 'ol' : 'ul', { dir: dirOf(items.join(' ')) }, ...items.map(t => el('li', { dir: dirOf(t) }, ...inline(t)))));
      continue;
    }
    if (/^-{3,}$/.test(line.trim())) { frag.append(el('hr')); i++; continue; }
    const para = []; while (i < L.length && L[i].trim() && !/^(#{1,6}\s|```|\s*\||\s*>|\s*([-*]|\d+\.)\s)/.test(L[i])) para.push(L[i++]);
    if (!para.length) para.push(L[i++]);
    frag.append(el('p', { dir: dirOf(para.join(' ')) }, ...inline(para.join(' '))));
  }
  return frag;
}

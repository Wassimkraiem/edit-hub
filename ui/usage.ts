// local addition: a Claude account's usage drawn like Claude's own usage screen: the current session (the 5-hour
// window) and the week, each a bar with how full it is and when it resets. Used by the Director chat and Crew >
// Requirements. u = { fiveHour, fiveHourResets, week, weekResets, at } from /api/accounts (seconds for resets).
import { h } from './app.js';

export function resetsIn(sec) {
  if (!sec) return '';
  const ms = sec * 1000 - Date.now();
  if (ms <= 0) return 'resets now';
  const m = Math.round(ms / 60000), hr = Math.floor(m / 60), d = Math.floor(hr / 24);
  if (d >= 1) return 'resets ' + new Date(sec * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return 'resets in ' + (hr ? `${hr} hr ` : '') + `${m % 60} min`;
}
// resets: seconds (from a Director reply) or Claude's own words (from /usage: "resets Nov 22, 10pm (Africa/Tunis)")
const when = r => typeof r === 'string' ? r.replace(/s*([^)]*)s*$/, '') : resetsIn(r);
function bar(label, pct, resets) {
  const known = typeof pct === 'number', level = !known ? '' : pct >= 90 ? ' is-full' : pct >= 70 ? ' is-high' : '';
  return h('div', { class: 'us-row' + level },
    h('div', { class: 'us-head' }, h('span', {}, label), h('span', { class: 'us-pct' }, known ? pct + '% used' : '—')),
    h('div', { class: 'us-track', role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': known ? String(pct) : null },
      h('span', { class: 'us-fill', style: { inlineSize: (known ? Math.min(100, pct) : 0) + '%' } })),
    h('div', { class: 'us-reset' }, known ? when(resets) : 'not checked yet'));
}
// compact: one line per window (for the Director's top bar); the reset time is in the tooltip
export function usageLine(u) {
  const one = (label, pct, resets) => h('span', { class: 'usl' + (pct >= 90 ? ' is-full' : pct >= 70 ? ' is-high' : ''), title: typeof pct === 'number' ? `${label}: ${pct}% used, ${when(resets)} (reading from Claude Code; claude.ai may differ)` : `${label}: not checked yet` },
    h('span', { class: 'usl-label' }, label), h('span', { class: 'us-track' }, h('span', { class: 'us-fill', style: { inlineSize: (typeof pct === 'number' ? Math.min(100, pct) : 0) + '%' } })), h('span', { class: 'us-pct' }, typeof pct === 'number' ? pct + '%' : '—'));
  return h('span', { class: 'usl-box' }, one('Session', u?.fiveHour, u?.fiveHourResetText || u?.fiveHourResets), one('Week', u?.week, u?.weekResetText || u?.weekResets));
}
export function usageBars(u) {
  const rows = Array.isArray(u?.windows) && u.windows.length ? u.windows.map(w => bar(w.label, w.pct, w.resets))
    : [bar('Current session', u?.fiveHour, u?.fiveHourResets), bar('This week', u?.week, u?.weekResets)];
  // Claude Code's reading; claude.ai's usage page (where limits are enforced) can differ, so it is one click away
  return h('div', { class: 'us' }, ...rows,
    h('div', { class: 'us-at' }, (u?.at ? 'Reading from Claude Code, checked ' + new Date(u.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' : ''),
      h('a', { href: 'https://claude.ai/settings/usage', target: '_blank', rel: 'noopener', title: 'Log in there with this account to see its usage as Claude shows it' }, 'claude.ai usage')));
}

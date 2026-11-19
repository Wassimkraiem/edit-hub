// @ts-nocheck
// TypeScript rewrite: not type-checked yet. Remove the line above and fix the errors to check this file.
// Edit Hub's first run: requirements, your style (palette, fonts, editing styles, with a live phone preview), your brand,
// your crew; then the Director writes your style skill from these choices (server/onboarding.js).
import { h, api, toast } from './app.js';

const PALETTES = [
  ['Midnight blue', ['#0B1220', '#2563EB', '#60A5FA', '#F5F8FF']], ['Clean white', ['#FFFFFF', '#111111', '#2563EB', '#E5E7EB']],
  ['Apple minimal', ['#000000', '#FFFFFF', '#8E8E93', '#0A84FF']], ['Warm creator', ['#1C1917', '#F97316', '#FDE68A', '#FAFAF9']],
  ['Neon tech', ['#05060A', '#22D3EE', '#A3E635', '#F8FAFC']], ['Pastel cartoon', ['#FFF7ED', '#F472B6', '#60A5FA', '#FACC15']],
  ['Editorial', ['#F5F1E8', '#111111', '#B91C1C', '#6B7280']], ['Forest', ['#0F1F17', '#22C55E', '#D9F99D', '#F0FDF4']],
];
const FONTS = [['Space Grotesk', 'DM Sans'], ['Inter', 'Inter'], ['Poppins', 'Open Sans'], ['Playfair Display', 'Inter'],
  ['Bebas Neue', 'Montserrat'], ['Fredoka', 'Nunito'], ['Archivo Black', 'Archivo'], ['IBM Plex Sans', 'IBM Plex Mono']];
const STYLES = [
  ['Apple minimal', 'Lots of space, one idea per screen, slow fades, quiet sound.'],
  ['Kinetic captions', 'Big word-by-word captions that move with the voice.'],
  ['Talking head + cards', 'Your face stays, clean glass cards explain the points.'],
  ['Cartoon explainer', 'Stickers, drawn characters, bouncy motion.'],
  ['Documentary', 'Serif titles, B-roll, calm music, a story told in chapters.'],
  ['Hype, fast cuts', 'Zoom punches, flashes, a sound on every cut.'],
  ['Screen tutorial', 'Zooms into your screen recording, highlights where to click.'],
  ['Podcast clip', 'Two-line captions, a waveform, the best moment of a long talk.'],
];
const PLATFORMS = ['Instagram Reels', 'TikTok', 'YouTube Shorts', 'YouTube', 'Facebook', 'LinkedIn', 'X'];
const CORE = ['editor'];

export async function welcomePage(main) {
  main.classList.add('wl');
  const fontLink = h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?' + [...new Set(FONTS.flat())].map(f => 'family=' + f.replace(/ /g, '+') + ':wght@400;700').join('&') + '&display=swap' });
  document.head.append(fontLink);
  const st = { step: 0, palette: PALETTES[0], fonts: FONTS[0], styles: new Set(['Kinetic captions']), notes: '',
    brand: { name: '', about: '', audience: '', platforms: new Set(['Instagram Reels', 'YouTube Shorts']), language: 'English', videos: '', cta: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    agents: null, uploads: true };
  const steps = ['Requirements', 'Your style', 'Your brand', 'Your crew'];
  const rail = h('ol', { class: 'wl-rail' }), body = h('div', { class: 'wl-body' }), nav = h('div', { class: 'wl-nav' });
  main.append(h('header', { class: 'wl-head' }, h('h1', {}, 'Welcome to Edit Hub'), h('p', {}, 'Four short steps, then drop a raw recording and get a finished video.')), rail, body, nav);
  const choice = (label, on, pick, extra = {}) => h('button', { type: 'button', class: 'wl-choice' + (on ? ' is-on' : ''), 'aria-pressed': String(on), onclick: pick, ...extra }, label);
  const go = n => { st.step = n; draw(); main.scrollTo?.(0, 0); };

  async function reqStep() {
    const box = h('div', { class: 'wl-list' }, h('p', {}, 'Checking your computer…'));
    const load = async () => {
      let r; try { r = await api('/api/requirements'); } catch (e) { box.replaceChildren(h('p', { class: 'wl-bad' }, e.message)); return; }
      box.replaceChildren(...r.items.map(i => h('div', { class: 'wl-req' + (i.ok ? ' is-ok' : i.optional ? ' is-opt' : ' is-bad') },
        h('span', { class: 'wl-badge' }, i.ok ? 'Ready' : i.optional ? 'Optional' : 'Needed'), h('div', {}, h('strong', {}, i.label), h('p', {}, i.detail)))),
        h('div', { class: 'wl-row' },
          h('button', { type: 'button', class: 'primary', onclick: async () => { try { await api('/api/requirements/setup', { method: 'POST' }); toast('Setup started: Edit Hub installs what it can. Check again in a minute.'); } catch (e) { toast(e.message, true); } } }, 'Quick setup'),
          h('a', { class: 'wl-link', href: '#/crew/requirements' }, 'Log in to Claude and more options'),
          h('button', { type: 'button', onclick: load }, 'Check again')));
    };
    load();
    return [h('h2', {}, 'What Edit Hub needs'), h('p', { class: 'wl-sub' }, 'Claude Code does the editing on your computer with your Claude plan. Quick setup installs the rest.'), box];
  }

  function styleStep() {
    const [pname, colors] = st.palette, [hf, bf] = st.fonts;
    // the caption takes the palette colour that reads best on its background (light palettes need dark text)
    const lum = c => { const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const ink = colors.slice(1).sort((a, b) => contrast(b, colors[0]) - contrast(a, colors[0]))[0];
    const preview = h('div', { class: 'wl-phone', style: `--p0:${colors[0]};--p1:${colors[1]};--p2:${colors[2]};--p3:${ink};--hf:'${hf}';--bf:'${bf}'` },
      h('div', { class: 'wl-phone-tag' }, [...st.styles][0] || 'Your style'), h('div', { class: 'wl-phone-cap' }, 'This is your', h('br'), h('b', {}, 'first video')),
      h('div', { class: 'wl-phone-sub' }, st.brand.name || 'Your channel'));
    return [h('div', { class: 'wl-split' }, h('div', {},
      h('h2', {}, 'Pick your look'), h('p', { class: 'wl-sub' }, 'Choose what you like. The Director turns it into your own style skill, and you can change everything later.'),
      h('h3', {}, 'Colours'), h('div', { class: 'wl-grid' }, ...PALETTES.map(p => choice(h('span', {}, h('span', { class: 'wl-swatches' }, ...p[1].map(c => h('i', { style: `background:${c}` }))), p[0]), p === st.palette, () => { st.palette = p; draw(); }))),
      h('h3', {}, 'Fonts'), h('div', { class: 'wl-grid' }, ...FONTS.map(f => choice(h('span', {}, h('b', { style: `font-family:'${f[0]}'` }, f[0]), h('small', { style: `font-family:'${f[1]}'` }, f[1] === f[0] ? 'one family' : 'with ' + f[1])), f === st.fonts, () => { st.fonts = f; draw(); }))),
      h('h3', {}, 'Editing styles (up to 3)'), h('div', { class: 'wl-grid wl-styles' }, ...STYLES.map(([n, d]) => choice(h('span', {}, h('b', {}, n), h('small', {}, d)), st.styles.has(n), () => { st.styles.has(n) ? st.styles.delete(n) : st.styles.size < 3 ? st.styles.add(n) : toast('Up to 3 styles: remove one first.'); draw(); }))),
      h('h3', {}, 'Anything else about your look?'),
      h('textarea', { rows: 3, class: 'wl-input', placeholder: 'For example: like Apple ads, my logo is a fox, no flashing, calm music…', oninput: e => { st.notes = e.target.value; } }, st.notes)),
      h('aside', { class: 'wl-aside' }, h('p', { class: 'wl-sub' }, 'Preview'), preview, h('p', { class: 'wl-small' }, `${pname} · ${hf} and ${bf}`)))];
  }

  function brandStep() {
    const b = st.brand, field = (label, key, ph, rows) => h('label', { class: 'wl-field' }, h('span', {}, label),
      h(rows ? 'textarea' : 'input', { class: 'wl-input', rows, value: b[key], placeholder: ph, oninput: e => { b[key] = e.target.value; } }, rows ? b[key] : null));
    return [h('h2', {}, 'Tell us about you'), h('p', { class: 'wl-sub' }, 'The crew reads this before every video, so every edit sounds and looks like you.'),
      h('div', { class: 'wl-form' },
        field('Channel or brand name (needed)', 'name', 'Nour Cooks'), field('What you make', 'about', 'Quick home recipes for busy people', 2),
        field('Who watches', 'audience', 'Students and young parents', 2), field('Language of your videos', 'language', 'English'),
        field('Kind of videos', 'videos', '30-second recipes, talking to camera', 2), field('What viewers should do at the end', 'cta', 'Follow for the next recipe'),
        field('Your time zone (for scheduling posts)', 'timezone', 'Europe/Paris')),
      h('h3', {}, 'Where you post'), h('div', { class: 'wl-chips' }, ...PLATFORMS.map(p => choice(p, b.platforms.has(p), () => { b.platforms.has(p) ? b.platforms.delete(p) : b.platforms.add(p); draw(); })))];
  }

  async function crewStep() {
    if (!st.agents) { try { const r = await api('/api/onboarding'); st.agents = r.agents.map(a => ({ ...a, on: true })); } catch (e) { return [h('p', { class: 'wl-bad' }, e.message)]; } }
    return [h('h2', {}, 'Your crew'), h('p', { class: 'wl-sub' }, 'A small crew on purpose: every extra agent starts from zero and costs tokens. The editor does the whole edit (clean cut, your style, captions, its own check); the writer does ideas and scripts; the Director talks to you and posts your videos. Every fix you make, they remember.'),
      h('div', { class: 'wl-list' }, ...st.agents.map(a => { const core = CORE.includes(a.id);
        return h('label', { class: 'wl-agent' + (a.on ? ' is-on' : '') }, h('input', { type: 'checkbox', checked: a.on, disabled: core, onchange: e => { a.on = e.target.checked; draw(); } }),
          h('div', {}, h('strong', {}, a.id.replace(/-/g, ' ') + (core ? ' (always on)' : '')), h('p', {}, a.description))); })),
      h('label', { class: 'wl-agent' + (st.uploads ? ' is-on' : '') }, h('input', { type: 'checkbox', checked: st.uploads, onchange: e => { st.uploads = e.target.checked; draw(); } }),
        h('div', {}, h('strong', {}, 'Let the Director post my videos'), h('p', {}, 'It schedules your finished renders on YouTube, Instagram and Facebook from your own Chrome (Claude in Chrome, see Requirements). Off: the Director starts without the browser, which uses fewer tokens.'))),
      h('p', { class: 'wl-small' }, 'Want your own agent? After setup: Crew, then New agent, or just ask the Director.')];
  }

  async function finish() {
    if (!st.brand.name.trim()) { go(2); toast('Give your channel or brand a name first.', true); return; }
    try {
      const r = await api('/api/onboarding', { method: 'POST', body: {
        style: { palette: st.palette[0], colors: st.palette[1], heading: st.fonts[0], body: st.fonts[1], editing: [...st.styles], notes: st.notes },
        brand: { ...st.brand, platforms: [...st.brand.platforms] },
        agents: st.agents ? st.agents.filter(a => a.on).map(a => a.id) : undefined,
        uploads: st.uploads } });   // posting on = the Director starts with Chrome
      toast(`Saved. The Director is now writing your style skill (${r.skill}).`);
      location.hash = '#/crew';
    } catch (e) { toast(e.message, true); }
  }

  async function draw() {
    rail.replaceChildren(...steps.map((s, i) => h('li', { class: i === st.step ? 'is-on' : i < st.step ? 'is-done' : '' }, h('button', { type: 'button', onclick: () => go(i) }, `${i + 1}. ${s}`))));
    const parts = await [reqStep, styleStep, brandStep, crewStep][st.step]();
    body.replaceChildren(...parts);
    nav.replaceChildren(st.step ? h('button', { type: 'button', onclick: () => go(st.step - 1) }, 'Back') : h('span'),
      st.step < steps.length - 1 ? h('button', { type: 'button', class: 'primary', onclick: () => go(st.step + 1) }, 'Next') : h('button', { type: 'button', class: 'primary', onclick: finish }, 'Finish and build my style'));
  }
  draw();
  return () => fontLink.remove();
}

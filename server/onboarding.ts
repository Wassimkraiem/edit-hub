// Edit Hub's first run: what the welcome page saves. The user's choices (palette, fonts, editing styles, brand) go into
// the crew's channel.md and brand.md; agents they switched off move to .claude/agents-off (back by moving them again);
// then the Director gets one "[Edit Hub style setup]" message and writes the user's own style skill from the choices.
import fs from 'node:fs';
import path from 'node:path';
import { config, saveConfig } from './config.js';
import { crewDir, agents } from './crew.js';
import * as director from './director.js';

const bad = msg => Object.assign(new Error(msg), { code: 400 });
const txt = (v, max = 400) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const list = (v, max = 12) => (Array.isArray(v) ? v : []).map(x => txt(x, 80)).filter(Boolean).slice(0, max);
export const slug = s => txt(s, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my';

// the page's answers → the two files the Director reads before every job, and the setup message
// what the welcome page sends (every field optional: the page is not trusted, so each is checked and trimmed below)
export type OnboardingBody = {
  style?: { palette?: string; colors?: string[]; heading?: string; body?: string; editing?: string[]; notes?: string };
  brand?: { name?: string; about?: string; audience?: string; platforms?: string[]; language?: string; videos?: string; cta?: string; timezone?: string };
  agents?: string[]; uploads?: boolean;
};
export function plan(body: OnboardingBody = {}) {
  const s: NonNullable<OnboardingBody['style']> = body.style || {}, b: NonNullable<OnboardingBody['brand']> = body.brand || {};
  const name = txt(b.name, 80); if (!name) throw bad('Give your channel or brand a name.');
  const colors = list(s.colors, 6).filter(c => /^#[0-9a-f]{6}$/i.test(c));
  const style = { palette: txt(s.palette, 60), colors, heading: txt(s.heading, 60), body: txt(s.body, 60), editing: list(s.editing, 6), notes: txt(s.notes, 800) };
  const brand = { name, about: txt(b.about, 600), audience: txt(b.audience, 400), platforms: list(b.platforms, 8), language: txt(b.language, 60) || 'English', videos: txt(b.videos, 400), cta: txt(b.cta, 200), timezone: txt(b.timezone, 60) };
  const skill = slug(name) + '-style';
  const channel = `# Channel profile: ${brand.name}\n\n- **What it is**: ${brand.about || 'to fill'}\n- **Audience**: ${brand.audience || 'to fill'}\n- **Platforms**: ${brand.platforms.join(', ') || 'to fill'}\n- **Language of the videos**: ${brand.language}\n- **Videos made here**: ${brand.videos || 'to fill'}\n- **Call to action**: ${brand.cta || 'to fill'}\n- **Time zone (for scheduling)**: ${brand.timezone || 'to fill'}\n- **Never**: invent numbers, quotes or results.\n`;
  const kit = `# Brand kit: ${brand.name}\n\n- **Style skill**: \`${skill}\` (in .claude/skills; every editor uses it)\n- **Palette**: ${style.palette || 'custom'} ${colors.join(' ')}\n- **Fonts**: ${style.heading || 'to fill'} for headings, ${style.body || 'to fill'} for text\n- **Editing styles chosen**: ${style.editing.join(', ') || 'to fill'}\n- **Notes from the user**: ${style.notes || 'none yet'}\n`;
  const message = `[Edit Hub style setup] ${brand.name} just finished Edit Hub's onboarding. Do these steps, then tell them in a few lines what you made:
1. Read channel.md and brand.md in your folder (onboarding just wrote them).
2. Create their style skill at .claude/skills/${skill}/SKILL.md (front matter: name ${skill}, a description saying when to use it). Build it from their choices: palette ${colors.join(', ') || style.palette || 'not chosen'}; fonts ${style.heading || '?'} / ${style.body || '?'}; editing styles ${style.editing.join(', ') || 'not chosen'}; notes: ${style.notes || 'none'}. Write it the way an editor needs it: colours as tokens with their roles, type sizes, caption style, transitions and pacing (a change every 2 to 3 seconds), sound (a sound on every transition), what to avoid, and an empty "## Notes from the user" section for their future fixes.
3. Make sure the editor uses it: add ${skill} to its skills line.
4. Ask them one question you still need (only if something important is missing), then say: drop a raw recording in the chat and say what you want.`;
  return { channel, kit, message, skill };
}

export function finish(body: OnboardingBody = {}, dir = crewDir()) {
  const p = plan(body);
  for (const [f, text] of [['channel.md', p.channel], ['brand.md', p.kit]]) {
    const file = path.join(dir, f);
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.before-onboarding');   // the old one stays beside it
    fs.writeFileSync(file, text);
  }
  // agents the user switched off: moved aside, never deleted
  const keep = new Set(list(body.agents, 40)), off = path.join(dir, '.claude', 'agents-off');
  const moved = [];
  if (Array.isArray(body.agents)) for (const a of agents(dir)) {
    if (keep.has(a.id) || ['editor'].includes(a.id)) continue;   // the editor does the standard job: it always stays
    fs.mkdirSync(off, { recursive: true }); fs.renameSync(path.join(dir, '.claude', 'agents', a.id + '.md'), path.join(off, a.id + '.md')); moved.push(a.id);
  }
  saveConfig({ onboarded: true, chrome: !!body.uploads });
  director.say({ text: p.message });
  return { ok: true, skill: p.skill, switchedOff: moved };
}

export function routes(route, readBody) {
  route('GET', '/api/onboarding', () => ({ onboarded: !!config().onboarded, agents: agents() }));
  route('POST', '/api/onboarding', async req => finish(await readBody(req)));
}

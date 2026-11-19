import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, slug } from './onboarding.js';
import { chromeConnected } from './requirements.js';

test('onboarding answers become the channel profile, the brand kit and one setup message for the Director', () => {
  const p = plan({ style: { palette: 'Ocean', colors: ['#2563EB', 'not-a-colour', '#ffffff'], heading: 'Space Grotesk', body: 'DM Sans', editing: ['Kinetic captions', 'Apple minimal'] },
    brand: { name: 'Nour Cooks', about: 'quick home recipes', platforms: ['Instagram', 'YouTube Shorts'], language: 'Arabic' } });
  assert.equal(p.skill, 'nour-cooks-style');
  assert.match(p.channel, /Nour Cooks/); assert.match(p.channel, /Instagram, YouTube Shorts/); assert.match(p.channel, /Arabic/);
  assert.match(p.kit, /#2563EB #ffffff/); assert.doesNotMatch(p.kit, /not-a-colour/);   // only real hex colours pass
  assert.match(p.message, /^\[Edit Hub style setup\]/); assert.match(p.message, /\.claude\/skills\/nour-cooks-style\/SKILL\.md/);
  assert.throws(() => plan({ brand: {} }), /name/);
  assert.equal(slug('  Été 2026!! '), 't-2026');
});

test('Claude in Chrome counts as connected once Claude Code wrote its browser host', async () => {
  const has = name => p => p.replace(/\\/g, '/').includes(name);
  assert.equal(await chromeConnected('darwin', '/h', has('Google/Chrome/NativeMessagingHosts')), true);
  assert.equal(await chromeConnected('linux', '/h', () => false), false);
  assert.equal(await chromeConnected('win32', '', () => false, async (cmd, args) => ({ ok: args[1].includes('Microsoft\\Edge') })), true);
});

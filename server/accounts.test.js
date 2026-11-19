import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const home = path.resolve('.test-tmp', 'accounts-home');
fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(path.join(home, '.claude', 'skills', 'my-style'), { recursive: true });
fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{"x":1}');
fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { videohub: {} }, oauthAccount: { emailAddress: 'main@x' }, userID: 'u1' }));
process.env.VIDEOHUB_CLAUDE_HOME = home;
const a = await import('./accounts.js');

test('a second Claude account: its own login, everything else shared with the main one', () => {
  assert.deepEqual(a.envFor('main'), {});
  a.add({ id: 'second' });
  assert.throws(() => a.add({ id: 'second' }), /already exists/);
  assert.throws(() => a.add({ id: 'Main' }), /lowercase|already/);
  const env = a.envFor('second'), dir = env.CLAUDE_CONFIG_DIR;
  assert.equal(dir, path.join(home, '.claude-accounts', 'second'));
  assert.ok(fs.existsSync(path.join(dir, 'skills', 'my-style')));   // linked, so skills match
  assert.ok(fs.lstatSync(path.join(dir, 'projects')).isSymbolicLink() || fs.existsSync(path.join(dir, 'projects')));
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{"x":1}');
  const st = JSON.parse(fs.readFileSync(path.join(dir, '.claude.json'), 'utf8'));
  assert.ok(st.mcpServers.videohub); assert.equal(st.oauthAccount, undefined); assert.equal(st.userID, undefined);   // never the main login
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { videohub: {} }, cachedUsageUtilization: { five_hour: 0.78 }, modelAccessCache: { x: 1 }, oauthAccount: { emailAddress: 'main@x' } }));
  a.envFor('second');
  const st2 = JSON.parse(fs.readFileSync(path.join(dir, '.claude.json'), 'utf8'));
  assert.equal(st2.cachedUsageUtilization, undefined); assert.equal(st2.modelAccessCache, undefined);   // never the main account's caches
  a.use({ id: 'second' }); assert.equal(a.active(), 'second');
  a.remove({ id: 'second' }); assert.equal(a.active(), 'main');
  assert.throws(() => a.use({ id: 'nobody' }), /No such account/);
});

test('usage per account: the 5-hour and weekly windows Claude Code reports, kept per account', () => {
  const u = a.recordUsage('main', { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.66, resetsAt: 1794853800 }, seven_day: { utilization: 0.05, resetsAt: 1795381200 } } });
  assert.equal(u.fiveHour, 66); assert.equal(u.week, 5); assert.equal(u.fiveHourResets, 1794853800);
  assert.equal(a.usageOf('main').week, 5); assert.equal(a.usageOf('nobody'), null);
  assert.throws(() => a.checkUsage('nobody'), /No such account/);
});

test("Claude Code's own /usage text becomes the account's usage, every window kept", () => {
  const u = a.parseUsage('You are currently using your subscription\n\nCurrent session: 78% used · resets Nov 16, 7:30pm (Africa/Tunis)\nCurrent week (all models): 6% used · resets Nov 22, 10pm (Africa/Tunis)\nCurrent week (Fable): 0% used · resets Nov 22, 10pm (Africa/Tunis)\n\nWhat is contributing…');
  assert.equal(u.fiveHour, 78); assert.equal(u.week, 6); assert.match(u.weekResetText, /^resets Nov 22, 10pm/);
  assert.deepEqual(u.windows.map(w => [w.label, w.pct]), [['Current session', 78], ['This week (all models)', 6], ['This week (Fable)', 0]]);
  assert.equal(a.parseUsage('not logged in'), null);
});

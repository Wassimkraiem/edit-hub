import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.test-tmp', 'history-projects'), crewDir = path.resolve('.test-tmp', 'history-crew');
fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(crewDir, { recursive: true, force: true });
process.env.VIDEOHUB_CLAUDE_PROJECTS = root; process.env.VIDEOHUB_CREW_DIR = crewDir;
process.env.VIDEOHUB_DATA_DIR ||= path.resolve('.test-tmp', 'data');   // never your real settings (archived ids live there)
process.env.VIDEOHUB_BASE_DIR ||= path.resolve('.test-tmp', 'base');
const h = await import('./history.js');

test('past Director conversations: listed newest first, your words / replies / steps, crew ones resumable', () => {
  const folder = h.transcriptsOf(crewDir); fs.mkdirSync(folder, { recursive: true });
  const id = '11111111-2222-3333-4444-555555555555';
  fs.writeFileSync(path.join(folder, id + '.jsonl'), [
    { type: 'session-owner' },
    { type: 'user', timestamp: '2026-11-15T10:00:00Z', message: { content: 'Clean my recording please' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', name: 'Agent', input: { subagent_type: 'audio-cleaner', description: 'clean take 3' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'done' }] } },
    { type: 'user', isMeta: true, message: { content: 'hidden' } },
    { type: 'user', message: { content: '<command-name>/clear</command-name>' } },
  ].map(x => JSON.stringify(x)).join('\n') + '\nnot json\n');
  fs.writeFileSync(path.join(folder, '99999999-2222-3333-4444-555555555555.jsonl'), JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'no user words' }] } }));
  const l = h.list();
  assert.equal(l.length, 1);   // a conversation without your words is left out
  assert.equal(l[0].title, 'Clean my recording please'); assert.equal(l[0].resumable, true); assert.equal(l[0].messages, 1);
  assert.deepEqual(h.read(id).items.map(i => [i.role, i.text]), [['you', 'Clean my recording please'], ['claude', 'On it.'], ['step', 'Briefed audio-cleaner: clean take 3']]);
  assert.throws(() => h.read('../x'), /bad conversation id/);
  assert.throws(() => h.read('00000000-0000-0000-0000-000000000000'), /not found/);
});

test('archive hides a conversation (Archived lists it, restore brings it back); delete moves it to the trash folder', () => {
  const folder = h.transcriptsOf(crewDir), id = '22222222-2222-3333-4444-555555555555';
  fs.writeFileSync(path.join(folder, id + '.jsonl'), JSON.stringify({ type: 'user', message: { content: 'Make a reel' } }));
  fs.mkdirSync(path.join(folder, id, 'subagents'), { recursive: true });
  assert.ok(h.list().some(c => c.id === id));
  h.archive({ id });
  assert.ok(!h.list().some(c => c.id === id)); assert.ok(h.list(50, { archived: true }).some(c => c.id === id));
  h.archive({ id, on: false });
  assert.ok(h.list().some(c => c.id === id)); assert.ok(!h.list(50, { archived: true }).some(c => c.id === id));
  h.archive({ id }); h.remove({ id });
  assert.ok(!fs.existsSync(path.join(folder, id + '.jsonl'))); assert.ok(!fs.existsSync(path.join(folder, id)));
  const trash = path.join(process.env.VIDEOHUB_DATA_DIR, 'trash', 'conversations');
  assert.ok(fs.existsSync(path.join(trash, id + '.jsonl'))); assert.ok(fs.existsSync(path.join(trash, id, 'subagents')));
  assert.equal(fs.readFileSync(path.join(trash, id + '.from.txt'), 'utf8'), folder);
  assert.ok(!h.list(50, { archived: true }).some(c => c.id === id));   // no longer in Archived either
  assert.throws(() => h.remove({ id }), /not found/); assert.throws(() => h.archive({ id: '../x' }), /bad conversation id/);
});

test('a film opens the conversation that launched it: the oldest one naming its folder, not a look-alike name', async () => {
  const folder = h.transcriptsOf(crewDir); fs.mkdirSync(folder, { recursive: true });
  const say = text => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { prompt: text } }] } });
  const launch = 'aaaaaaaa-0000-0000-0000-000000000001', later = 'aaaaaaaa-0000-0000-0000-000000000002', other = 'aaaaaaaa-0000-0000-0000-000000000003';
  fs.writeFileSync(path.join(folder, launch + '.jsonl'), say(String.raw`Edit it in D:\VideoHub\films\reel-x (brand style)`));
  await new Promise(r => setTimeout(r, 30));
  fs.writeFileSync(path.join(folder, later + '.jsonl'), say('Fix notes in D:/VideoHub/films/reel-x/index.html'));
  fs.writeFileSync(path.join(folder, other + '.jsonl'), say(String.raw`New film D:\VideoHub\films\reel-x-2`));
  assert.equal(h.ofFilm(String.raw`D:\VideoHub\films\reel-x`).id, launch);
  assert.equal(h.ofFilm(String.raw`D:\VideoHub\films\reel-x-2\ `.trim()).id, other);   // a trailing backslash too
  assert.equal(h.ofFilm(String.raw`D:\VideoHub\films\never-made`).id, null);
  assert.throws(() => h.ofFilm(''), /no film folder/);
});

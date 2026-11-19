import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TOOLS } from './util.js';
import { editAudio, undoAudio, shiftWords, replace } from './audiocut.js';

const dir = path.resolve('.test-tmp', 'audiocut-film');
const dur = f => +execFileSync(TOOLS.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();

test('the edited audio replaces a file the preview still has open', () => {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'open.wav'), tmp = path.join(dir, 'open.vh-edit.wav');
  fs.writeFileSync(f, 'old'); fs.writeFileSync(tmp, 'new');
  const fd = fs.openSync(f, 'r');
  try { replace(tmp, f); } finally { fs.closeSync(fd); }
  assert.equal(fs.readFileSync(f, 'utf8'), 'new'); assert.ok(!fs.existsSync(tmp));
});

test('word timings: words in the cut go, words after it come earlier', () => {
  assert.deepEqual(shiftWords([[0, 1, 'a'], [1.2, 1.8, 'b'], [3, 3.5, 'c']], 1, 2), [[0, 1, 'a'], [2, 2.5, 'c']]);
});

test('mute keeps the length, cut shortens it and moves words.json, undo puts each back', async t => {
  try { execFileSync(TOOLS.ffmpeg, ['-version']); } catch { return t.skip('no ffmpeg'); }
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
  const wav = path.join(dir, 'audio', 'mix.wav');
  execFileSync(TOOLS.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', wav]);
  fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify([[0.5, 0.9, 'one'], [2.5, 3, 'two']]));
  const p = { id: 'x', path: dir, outputs: [] };
  await editAudio(p, { action: 'mute', start: 1, end: 2 });
  assert.ok(Math.abs(dur(wav) - 4) < 0.05);
  await editAudio(p, { action: 'cut', start: 1, end: 2 });
  assert.ok(Math.abs(dur(wav) - 3) < 0.05);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'words.json'), 'utf8')), [[0.5, 0.9, 'one'], [1.5, 2, 'two']]);
  undoAudio(p);
  assert.ok(Math.abs(dur(wav) - 4) < 0.05);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'words.json'), 'utf8')), [[0.5, 0.9, 'one'], [2.5, 3, 'two']]);
  undoAudio(p);
  assert.throws(() => undoAudio(p), /Nothing to undo/);
  await assert.rejects(editAudio(p, { action: 'cut', start: 2, end: 1 }), /Select a range/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TOOLS, readJson } from './util.js';
import { cutVideo } from './jobs.js';
import { vhDir } from './notes.js';

const dir = path.resolve('.test-tmp', 'videocut-film');
const dur = f => +execFileSync(TOOLS.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();

test('the razor on a rendered video: each cut is a new version, the source stays', async t => {
  try { execFileSync(TOOLS.ffmpeg, ['-version']); } catch { return t.skip('no ffmpeg'); }
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, 'film_v1.mp4');
  execFileSync(TOOLS.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]);
  const p = { id: 'videocut-test', name: 'film', title: 'film', path: dir, outputs: [{ name: 'film_v1.mp4', rel: 'film_v1.mp4', role: 'final', mtime: 1 }], latest: 'film_v1.mp4' };
  const r = await cutVideo(p, { file: 'film_v1.mp4', action: 'remove', start: 1, end: 2 });
  assert.equal(r.v, 2); assert.equal(r.file, 'film_v2.mp4');
  assert.ok(Math.abs(dur(path.join(dir, 'film_v2.mp4')) - 3) < 0.15);
  assert.ok(Math.abs(dur(src) - 4) < 0.15);   // the source is untouched
  const m = await cutVideo(p, { file: 'film_v1.mp4', action: 'mute', start: 1, end: 2 });
  assert.ok(Math.abs(dur(path.join(dir, m.file)) - 4) < 0.15);
  const b = await cutVideo(p, { file: 'film_v1.mp4', action: 'black', start: 1, end: 2 });
  assert.ok(Math.abs(dur(path.join(dir, b.file)) - 4) < 0.15);
  const versions = readJson(path.join(vhDir(p), 'versions.json'), []);
  assert.deepEqual(versions.map(v => v.mode), ['cut', 'cut', 'cut']);
  await assert.rejects(cutVideo(p, { file: '../outside.mp4', action: 'remove', start: 1, end: 2 }), /Open a rendered video/);
  await assert.rejects(cutVideo(p, { file: 'film_v1.mp4', action: 'remove', start: 2, end: 1 }), /Select a piece/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { baseDir } from './config.js';
import * as scripts from './scripts.js';

test('scripts: every script*.md with its video, read and saved, nothing outside the two folders', () => {
  const dir = path.join(baseDir(), 'analyses', 'ig-test');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'script-darija.md'), '# Astryx, my version\n\n| # | line |\n|---|---|\n| 1 | سطر |\n');
  fs.writeFileSync(path.join(dir, 'source.json'), JSON.stringify({ title: 'Video by nick', uploader: 'nick', webpage_url: 'https://example.com/p/1', duration: 34 }));
  fs.writeFileSync(path.join(dir, 'transcript.md'), 'the original words');
  fs.writeFileSync(path.join(dir, 'contact-sheet.jpg'), 'jpg');
  const s = scripts.list().find(x => x.id === 'analyses/ig-test/script-darija.md');
  assert.equal(s.title, 'Astryx, my version'); assert.equal(s.video.author, 'nick'); assert.equal(s.cover, 'contact-sheet.jpg');
  const r = scripts.read(s.id); assert.equal(r.transcript, 'the original words');
  scripts.write({ id: s.id, text: '# New\n' }); assert.equal(scripts.read(s.id).text, '# New\n');
  for (const bad of ['analyses/../x.md', 'films/a/b.md', 'analyses/ig-test/../../secret.md']) assert.throws(() => scripts.fileOf(bad), /Not a script/);
  assert.throws(() => scripts.picture(s.id, '../../../x.jpg', {}), /No such picture/);
});

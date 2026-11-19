// @ts-nocheck
// TypeScript rewrite: not type-checked yet. Remove the line above and fix the errors to check this file.
// local addition: quick audio fixes from the editor, straight with ffmpeg (no agent). On the film's own audio file
// (the one the live preview plays): "mute" silences a range and keeps every timing; "cut" removes the range, so the
// sound after it comes earlier (words.json, if the film has one in the simple [[start, end, word], …] form, is
// shifted to match). Every change backs the files up first in .videohub/audio-backups; "undo" puts back the last one.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { TOOLS, isInside } from './util.js';
import { readMeta } from './legacy.js';
import { vhDir } from './notes.js';
import { audioOf } from './live.js';

const bad = (msg, code = 400) => Object.assign(new Error(msg), { code });
const EDITABLE = /\.(wav|mp3|m4a|aac|flac|ogg)$/i;
const backups = p => path.join(vhDir(p), 'audio-backups');
const ff = (args, cmd) => new Promise((res, rej) => execFile(cmd || TOOLS.ffmpeg, args, { windowsHide: true, maxBuffer: 16e6 }, (e, o, err) => e ? rej(bad('ffmpeg failed: ' + String(err || e.message).trim().split('\n').slice(-2).join(' '), 500)) : res()));

// Windows refuses to rename over a file another handle has open (the preview streaming the film's sound): EPERM.
// Writing the new contents into the open file works, so that is the fallback.
export function replace(tmp, file) {
  try { fs.renameSync(tmp, file); }
  catch (e) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; fs.copyFileSync(tmp, file); fs.rmSync(tmp, { force: true }); }
}
export function filmAudio(p) {
  const f = audioOf(p, readMeta(path.join(vhDir(p), 'project.json'), {}));
  if (!f) throw bad('This film has no audio file to edit.');
  if (!isInside(f, p.path) || !EDITABLE.test(f)) throw bad('The film plays its sound from a render, not an audio file of its own; ask the Director to fix the sound in the code.');
  return f;
}
// words.json in the film folder, in the simple form only; anything else is left alone
function words(p) {
  const f = path.join(p.path, 'words.json');
  try { const w = JSON.parse(fs.readFileSync(f, 'utf8')); if (Array.isArray(w) && w.every(x => Array.isArray(x) && typeof x[0] === 'number' && typeof x[1] === 'number')) return { f, w }; } catch { }
  return null;
}
export const shiftWords = (w, a, b) => w.filter(([s, e]) => e <= a || s >= b).map(x => x[0] >= b ? [+(x[0] - (b - a)).toFixed(3), +(x[1] - (b - a)).toFixed(3), ...x.slice(2)] : x);

export async function editAudio(p, { action, start, end }: { action?: any; start?: any; end?: any } = {}, cmd) {
  if (!['mute', 'cut'].includes(action)) throw bad('action is mute or cut');
  const a = +start, b = +end;
  if (!(a >= 0 && b > a && b - a < 600)) throw bad('Select a range on the timeline first (start before end).');
  const file = filmAudio(p), ext = path.extname(file), stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(backups(p), stamp); fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(file, path.join(dir, path.basename(file)));
  fs.writeFileSync(path.join(dir, 'edit.json'), JSON.stringify({ file, action, start: a, end: b }, null, 1));
  const W = action === 'cut' ? words(p) : null;
  if (W) fs.copyFileSync(W.f, path.join(dir, 'words.json'));
  const tmp = file.slice(0, -ext.length) + '.vh-edit' + ext;
  const filter = action === 'mute' ? `volume=enable='between(t,${a},${b})':volume=0` : `aselect='not(between(t,${a},${b}))',asetpts=N/SR/TB`;
  try { await ff(['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-af', filter, '-vn', tmp], cmd); replace(tmp, file); }
  catch (e) { fs.rmSync(tmp, { force: true }); fs.rmSync(dir, { recursive: true, force: true }); throw e; }   // nothing changed: no backup to undo
  if (W) fs.writeFileSync(W.f, JSON.stringify(shiftWords(W.w, a, b)));
  return { ok: true, file, action, start: a, end: b, words: !!W };
}
export function undoAudio(p) {
  let last; try { last = fs.readdirSync(backups(p)).sort().pop(); } catch { }
  if (!last) throw bad('Nothing to undo.');
  const dir = path.join(backups(p), last), meta = JSON.parse(fs.readFileSync(path.join(dir, 'edit.json'), 'utf8'));
  if (!isInside(meta.file, p.path)) throw bad('That backup points outside the film.');
  fs.copyFileSync(path.join(dir, path.basename(meta.file)), meta.file);
  if (fs.existsSync(path.join(dir, 'words.json'))) fs.copyFileSync(path.join(dir, 'words.json'), path.join(p.path, 'words.json'));
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true, undone: meta };
}

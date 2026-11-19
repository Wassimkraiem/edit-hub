// local addition: the Scripts page. Every script the crew writes, with the video it came from: the Markdown files
// named script*.md in <workspace>/analyses/<video>/ (next to the analyzer's source.json, transcript and contact
// sheet) and in <workspace>/scripts/<name>/ (scripts with no video). Read, edit and save; the folder's pictures
// (contact sheet, frames) are served for the page.
import fs from 'node:fs';
import path from 'node:path';
import { baseDir } from './config.js';

const ROOTS = () => ['analyses', 'scripts'].map(d => path.join(baseDir(), d));
const ID = /^(analyses|scripts)\/[^/\\]+\/[^/\\]+\.md$/;
const IMG = /\.(jpe?g|png|webp)$/i;
const bad = (m, code = 400) => Object.assign(new Error(m), { code });
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// id "analyses/<folder>/<file>.md" → its file, refused outside the two folders
export function fileOf(id) {
  if (!ID.test(String(id)) || String(id).includes('..')) throw bad('Not a script: ' + id);
  return path.join(baseDir(), ...id.split('/'));
}
function titleOf(text, fallback) { const m = /^#\s+(.+)$/m.exec(text); return (m ? m[1] : fallback).trim().slice(0, 140); }
function videoOf(dir) {
  const s = readJson(path.join(dir, 'source.json'));
  if (!s) return null;
  return { title: s.title || null, author: s.uploader || s.channel || null, url: s.webpage_url || null, duration: s.duration || null, caption: (s.description || '').slice(0, 400), date: s.upload_date || null };
}
const coverOf = dir => ['contact-sheet.jpg', 'contact-sheet.png'].find(n => fs.existsSync(path.join(dir, n))) || null;

export function list() {
  const out = [];
  for (const root of ROOTS()) {
    let folders = []; try { folders = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { }
    for (const d of folders) {
      const dir = path.join(root, d.name);
      for (const f of fs.readdirSync(dir).filter(n => /^script.*\.md$/i.test(n))) {
        const file = path.join(dir, f), text = fs.readFileSync(file, 'utf8');
        out.push({ id: `${path.basename(root)}/${d.name}/${f}`, title: titleOf(text, d.name), folder: d.name, video: videoOf(dir), cover: coverOf(dir), updated: fs.statSync(file).mtimeMs });
      }
    }
  }
  return out.sort((a, b) => b.updated - a.updated);
}
export function read(id) {
  const f = fileOf(id), dir = path.dirname(f);
  if (!fs.existsSync(f)) throw bad('Script not found', 404);
  const tr = path.join(dir, 'transcript.md');
  return { id, path: f, folder: dir, text: fs.readFileSync(f, 'utf8'), video: videoOf(dir), cover: coverOf(dir), transcript: fs.existsSync(tr) ? fs.readFileSync(tr, 'utf8').slice(0, 200000) : null };
}
export function write({ id, text }: { id?: any; text?: any } = {}) {
  if (typeof text !== 'string') throw bad('text must be text');
  const f = fileOf(id); if (!fs.existsSync(f)) throw bad('Script not found', 404);
  fs.writeFileSync(f, text); return read(id);
}
// a picture of the script's folder (contact sheet, a frame), for the page
export function picture(id, name, res) {
  const dir = path.dirname(fileOf(id)), f = path.join(dir, ...String(name).split('/'));
  if (!IMG.test(f) || path.relative(dir, f).startsWith('..') || !fs.existsSync(f)) throw bad('No such picture', 404);
  res.writeHead(200, { 'Content-Type': /png$/i.test(f) ? 'image/png' : /webp$/i.test(f) ? 'image/webp' : 'image/jpeg', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}

export function routes(route, readBody) {
  route('GET', '/api/scripts', () => list());
  route('GET', '/api/script', (req, url) => read(url.searchParams.get('id')));
  route('POST', '/api/script', async req => write(await readBody(req)));
  route('GET', '/api/script/picture', (req, url, g, res) => { picture(url.searchParams.get('id'), url.searchParams.get('name'), res); return new Promise(r => res.on('close', r)); });
}

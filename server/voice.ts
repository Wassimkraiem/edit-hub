// local addition: voice input for the Crew page. The page records the microphone and posts the audio here; a local
// Whisper worker (whisper_worker.py, faster-whisper on the GPU) turns it into text. Audio never leaves this PC.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { HUB_DIR, TOOLS } from './util.js';
import { fileOf } from './crew.js';

let worker = null, queue = [], idleTimer = null;
const IDLE_MS = 10 * 60e3;   // the model holds ~3 GB of GPU memory: let it go after 10 quiet minutes

function start(cmd, args) {
  const v = config().voice || {};
  const py = cmd || v.python || process.env.VIDEOHUB_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const w = spawn(py, args || [path.join(HUB_DIR, 'server', 'whisper_worker.py'), v.model || 'large-v3'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  let err = '';
  w.stderr.on('data', d => { err = (err + d).slice(-2000); });
  readline.createInterface({ input: w.stdout }).on('line', line => {
    const job = queue.shift(); if (!job) return;
    let r; try { r = JSON.parse(line); } catch { r = { error: 'unreadable answer from the voice worker' }; }
    r.error ? job.reject(Object.assign(new Error('Voice: ' + r.error), { code: 500 })) : job.resolve(r);
  });
  const fail = msg => { for (const j of queue.splice(0)) j.reject(Object.assign(new Error(msg), { code: 500 })); if (worker === w) worker = null; };
  w.on('error', e => fail('Voice input needs Python with faster-whisper (pip install faster-whisper): ' + e.message));
  w.on('close', code => fail('The voice worker stopped' + (code ? ` (exit ${code}): ` + err.trim().split('\n').slice(-2).join(' ') : '')));
  return w;
}
export function transcribe(file: string, { language, prompt }: { language?: string | null; prompt?: string } = {}, cmd?: string, args?: string[]) {
  if (!worker) worker = start(cmd, args);
  clearTimeout(idleTimer); idleTimer = setTimeout(stop, IDLE_MS); idleTimer.unref?.();
  return new Promise((resolve, reject) => {
    queue.push({ resolve, reject });
    worker.stdin.write(JSON.stringify({ path: file, language: language || null, prompt: prompt || null, ffmpeg: TOOLS.ffmpeg }) + '\n');
  });
}
export function stop() { if (worker) { worker.stdin.end(); worker.kill(); worker = null; } }

// a hint that helps Whisper spell your words (names, tools, styles): the crew folder's voice-words.txt
const PROMPT = () => { try { return fs.readFileSync(fileOf('voice-words.txt'), 'utf8').trim().slice(0, 800); } catch { return 'Claude Code, VideoHub, reel, edit, script, render, skill.'; } };

// the language you talk in: English unless config voice.language says another ("auto": Whisper guesses, which turned
// English speech into Arabic text when the words hint had Darija in it). Scripts are written in Darija by the crew, not here.
export const LANG = asked => { const l = String(asked || config().voice?.language || 'en').toLowerCase(); return l === 'auto' ? null : l; };

export function routes(route) {
  // the body is the raw recording (audio/webm from the page), at most 25 MB
  route('POST', '/api/voice/transcribe', async (req, url) => {
    const file = path.join(os.tmpdir(), `videohub-voice-${process.pid}-${Date.now()}.webm`);
    await new Promise((resolve, reject) => {
      let n = 0; const out = fs.createWriteStream(file);
      req.on('data', b => { n += b.length; if (n > 25 << 20) { reject(Object.assign(new Error('Recording too long'), { code: 413 })); req.destroy(); out.destroy(); } else out.write(b); });
      req.on('end', () => out.end(resolve)); req.on('error', reject);
    });
    try { return await transcribe(file, { language: LANG(url.searchParams.get('lang')), prompt: PROMPT() }); }
    finally { fs.rm(file, { force: true }, () => { }); }
  });
}

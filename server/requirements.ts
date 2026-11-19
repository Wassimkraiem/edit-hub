// local addition: what the Crew needs, checked and set up from the Crew page. Claude Code (installed and logged in:
// a Claude subscription or account), ffmpeg, Python with faster-whisper, and the Whisper model for the voice input.
// The model is downloaded here (into the usual Hugging Face cache), never shipped with VideoHub. Quick setup does
// the parts that can be done for you; logging in happens in the Director's terminal (claude auth login).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { config, saveConfig } from './config.js';
import { TOOLS } from './util.js';
import { findClaude, cleanEnv } from './terminal.js';
import * as voice from './voice.js';

let notify: (ev: { kind: string; [field: string]: unknown }) => void = () => { }, running = false;
export const onSetup = fn => { notify = fn; };
const run = (cmd: string, args: string[], ms = 20000) => new Promise<{ ok: boolean; out: string; err: string }>(r => execFile(cmd, args, { windowsHide: true, timeout: ms, maxBuffer: 8e6, env: cleanEnv() }, (e, out, err) => r({ ok: !e, out: String(out || ''), err: String(err || e?.message || '') })));
const python = () => config().voice?.python || process.env.VIDEOHUB_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const model = () => config().voice?.model || 'large-v3';
const hfCache = () => process.env.HF_HUB_CACHE || path.join(process.env.HF_HOME || path.join(os.homedir(), '.cache', 'huggingface'), 'hub');
export const modelCached = (m = model(), root = hfCache()) => fs.existsSync(path.join(root, `models--Systran--faster-whisper-${m}`, 'snapshots'));

export async function check() {
  const claude = findClaude();
  const [auth, ff, py, gpu] = await Promise.all([
    claude ? run(claude, ['auth', 'status']) : null,
    run(TOOLS.ffmpeg, ['-version']),
    run(python(), ['-c', 'import faster_whisper; print(faster_whisper.__version__)']),
    run('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader']),
  ]);
  let login = null; try { login = JSON.parse(auth?.out || 'null'); } catch { }
  const items: { id: string; label: string; ok: boolean; detail: string; optional?: boolean }[] = [
    { id: 'claude', label: 'Claude Code installed', ok: !!claude, detail: claude || 'Install it from claude.ai/install (or the Claude desktop app), then check again.' },
    { id: 'login', label: 'Logged in to Claude', ok: !!login?.loggedIn, detail: login?.loggedIn ? (login.authMethod === 'claude.ai' ? 'Claude subscription' : login.authMethod || 'logged in') : 'Press "Log in to Claude": it opens the sign-in in your browser.' },
    { id: 'ffmpeg', label: 'ffmpeg', ok: ff.ok, detail: ff.ok ? ff.out.split('\n')[0].slice(0, 80) : 'VideoHub\'s setup installs it; or install ffmpeg and check again.' },
    { id: 'python', label: 'Python with faster-whisper (voice input)', ok: py.ok, detail: py.ok ? 'faster-whisper ' + py.out.trim() : 'Quick setup installs it (needs Python 3.10+ from python.org).' },
    { id: 'model', label: `Voice model (${model()})`, ok: modelCached(), detail: modelCached() ? 'downloaded' : 'Quick setup downloads it once (' + (model() === 'large-v3' ? 'about 3 GB' : 'a few hundred MB') + ').' },
  ];
  const chrome = await chromeConnected();
  items.push({ id: 'chrome', optional: true, label: 'Claude in Chrome (to post your videos)', ok: chrome, detail: chrome
    ? 'connected: the Director can post from your Chrome (signed in to a Claude Pro or Max plan)'
    : 'Optional, for posting your videos: install the Claude in Chrome extension (chromewebstore.google.com, search "Claude"), sign in with the same Claude account, then run "claude --chrome" once in a terminal and check again.' });
  return { items, gpu: gpu.ok ? gpu.out.trim().split('\n')[0] : null, ready: items.every(i => i.ok || i.optional), running };
}
// Claude Code writes a "native messaging host" for its Chrome extension the first time Chrome is connected
// (code.claude.com/docs/en/chrome): a registry key on Windows, a JSON file on macOS and Linux, for Chrome or Edge
const HOST = 'com.anthropic.claude_code_browser_extension';
export async function chromeConnected(platform = process.platform, home = os.homedir(), exists = fs.existsSync, query = run) {
  if (platform === 'win32') {
    for (const b of ['Google\\Chrome', 'Microsoft\\Edge']) if ((await query('reg', ['query', `HKCU\\Software\\${b}\\NativeMessagingHosts\\${HOST}`], 5000)).ok) return true;
    return false;
  }
  const dirs = platform === 'darwin'
    ? ['Library/Application Support/Google/Chrome', 'Library/Application Support/Microsoft Edge']
    : ['.config/google-chrome', '.config/microsoft-edge'];
  return dirs.some(d => exists(path.join(home, d, 'NativeMessagingHosts', HOST + '.json')));
}

// one step: a command whose output lines go to the page
const step = (label: string, cmd: string, args: string[]) => new Promise<void>((resolve, reject) => {
  notify({ kind: 'step', label });
  const p = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' } });
  const line = d => String(d).split(/\r?\n|\r/).filter(Boolean).forEach(text => notify({ kind: 'log', text: text.slice(0, 300) }));
  p.stdout.on('data', line); p.stderr.on('data', line);
  p.on('error', e => reject(new Error(`${label}: ${e.message}`)));
  p.on('close', code => code === 0 ? resolve() : reject(new Error(`${label} failed (exit ${code})`)));
});

export async function quickSetup() {
  if (running) throw Object.assign(new Error('Setup is already running.'), { code: 409 });
  const before = await check();
  const hasWhisper = before.items.find(i => i.id === 'python').ok;
  if (!hasWhisper && !(await run(python(), ['--version'])).ok) throw Object.assign(new Error('Python was not found. Install Python 3.10 or newer from python.org (tick "Add to PATH"), then press Quick setup again.'), { code: 400 });
  running = true; notify({ kind: 'start' });
  (async () => {
    // no NVIDIA card: the small model, fast enough on a CPU; with one: large-v3 and the CUDA libraries
    if (!before.gpu && !config().voice?.model) saveConfig({ voice: { ...(config().voice || {}), model: 'small' } });
    const pkgs = ['faster-whisper', ...(before.gpu && process.platform !== 'darwin' ? ['nvidia-cublas-cu12', 'nvidia-cudnn-cu12==9.*'] : [])];
    if (!hasWhisper) await step('Installing faster-whisper', python(), ['-m', 'pip', 'install', '--upgrade', ...pkgs]);
    if (!modelCached()) await step(`Downloading the voice model (${model()})`, python(), ['-c', `from faster_whisper import download_model; print(download_model(${JSON.stringify(model())}))`]);
    voice.stop();   // the next recording starts a worker with what was just installed
  })().then(() => notify({ kind: 'done' }), e => notify({ kind: 'error', text: e.message })).finally(() => { running = false; });
  return { started: true };
}

export function routes(route) {
  route('GET', '/api/requirements', () => check());
  route('POST', '/api/requirements/setup', () => quickSetup());
}

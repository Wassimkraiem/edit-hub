#!/usr/bin/env node
// snap-words.mjs — Whisper words ({t,s,e}) → the kit's {words:[{text,start,end}]}, each word trimmed to the speech side of
// any silence inside it (Whisper stretches a word over the pause before/after it, which hides pauses from cut-silences).
//   node scripts/snap-words.mjs raw.whisper.json raw.MOV raw.json [--noise -38] [--min 0.25]
//   node scripts/snap-words.mjs --selftest
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { argv, exit } from "node:process";

export function snap(words, silences) {
  return words.map(({ text, start, end }) => {
    for (const [a, b] of silences) {
      if (b <= start || a >= end) continue;              // no overlap
      if (a <= start + 0.05) start = Math.max(start, b); // silence at the head: speech starts after it
      else end = Math.min(end, a);                       // silence inside or at the tail: speech ends before it
    }
    return { text, start: +start.toFixed(3), end: +Math.max(end, start + 0.04).toFixed(3) };
  });
}

// Speech no word covers (Whisper skips retakes and short words): tag it "[?]" so cut-silences keeps it and the
// reviewer decides. Speech = between silences, inside the transcript's span; pieces under 0.25 s are breaths/clicks.
export function uncovered(words, silences, min = 0.25) {
  let end = Math.max(...words.map(w => w.end));                      // speech after the last word runs to the next silence that follows real speech
  for (const [a, b] of silences) { if (b <= end) continue; if (a - end >= min) { end = a; break; } end = b; }
  const out = [];
  let t = Math.min(...words.map(w => w.start));
  const speech = [];
  for (const [a, b] of silences) { if (a > t) speech.push([t, Math.min(a, end)]); t = Math.max(t, b); if (t >= end) break; }
  if (t < end) speech.push([t, end]);
  for (let [a, b] of speech) {
    for (const w of words.filter(w => w.end > a && w.start < b).sort((x, y) => x.start - y.start)) {
      if (w.start - a >= min) out.push({ text: "[?]", start: +a.toFixed(3), end: +w.start.toFixed(3) });
      a = Math.max(a, w.end);
    }
    if (b - a >= min) out.push({ text: "[?]", start: +a.toFixed(3), end: +b.toFixed(3) });
  }
  return out;
}

function silencesOf(video, noise, min) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", video, "-af", `silencedetect=n=${noise}dB:d=${min}`, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const s = [...r.stderr.matchAll(/silence_start: ([\d.]+)/g)].map(m => +m[1]), e = [...r.stderr.matchAll(/silence_end: ([\d.]+)/g)].map(m => +m[1]);
  return s.map((a, i) => [a, e[i] ?? Infinity]);
}

if (argv[2] === "--selftest") {
  const out = snap([{ text: "a", start: 1, end: 6 }, { text: "b", start: 6, end: 9 }], [[2, 5.5], [5.9, 7]]);
  console.assert(out[0].start === 1 && out[0].end === 2, "pause inside/after a word cuts its end", out[0]);
  console.assert(out[1].start === 7 && out[1].end === 9, "pause at a word's head moves its start", out[1]);
  const h = uncovered([{ text: "a", start: 0, end: 1 }, { text: "b", start: 3, end: 4 }], [[1.2, 1.5]]);
  console.assert(h.length === 1 && h[0].start === 1.5 && h[0].end === 3, "speech between words is tagged", h);
  const tl = uncovered([{ text: "a", start: 0, end: 1 }], [[1.1, 1.3], [1.8, 9]]);
  console.assert(tl.length === 1 && tl[0].start === 1.3 && tl[0].end === 1.8, "speech after the last word is tagged", tl);
  console.log("selftest ok"); exit(0);
}
const [inp, video, outp] = argv.slice(2);
if (!outp) { console.error("usage: node snap-words.mjs raw.whisper.json raw.MOV raw.json [--noise -38] [--min 0.25]"); exit(1); }
const opt = (k, d) => { const i = argv.indexOf(k); return i > 0 ? +argv[i + 1] : d; };
const raw = JSON.parse(readFileSync(inp, "utf8"));
const words = raw.words.map(w => ({ text: (w.text ?? w.t).trim(), start: w.start ?? w.s, end: w.end ?? w.e }));
const sil = silencesOf(video, opt("--noise", -38), opt("--min", 0.25));
const snapped = snap(words, sil), holes = uncovered(snapped, sil);
writeFileSync(outp, JSON.stringify({ words: [...snapped, ...holes].sort((a, b) => a.start - b.start) }, null, 1));
console.log(`wrote ${outp}: ${words.length} words, ${sil.length} silences, ${holes.length} untranscribed speech spans tagged [?]`);

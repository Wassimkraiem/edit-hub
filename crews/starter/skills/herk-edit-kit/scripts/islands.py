"""islands.py — split a recording at its pauses and transcribe every speech island on its own.

Whisper on a whole take merges retakes into one stretched word and drops short restarts, and its word times are too
loose to cut on (cuts landed before ".claude-mem" and before "t5dem 3lih"). Islands are bounded by measured silence,
so a cut between islands can never clip a word, and each island is transcribed alone, so every retake shows up.

  python -I islands.py raw.MOV islands.json [--noise -38] [--gap 0.35] [--lang ar] [--model large-v3]
  python -I islands.py --selftest
Writes {islands:[{i, start, end, text}]} (source seconds) and prints one line per island.
"""
import argparse, json, re, subprocess, sys

sys.stdout.reconfigure(encoding="utf-8")


def speech_islands(silences, dur, gap):
    """Speech = complement of silences; islands closer than `gap` merge (a breath inside a phrase is not a cut point)."""
    out, t = [], 0.0
    for a, b in silences:
        if a > t: out.append([t, a])
        t = max(t, b)
    if t < dur: out.append([t, dur])
    merged = []
    for a, b in out:
        if b - a < 0.08: continue                                  # clicks
        if merged and a - merged[-1][1] < gap: merged[-1][1] = b
        else: merged.append([a, b])
    return merged


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("media", nargs="?"); ap.add_argument("out", nargs="?")
    ap.add_argument("--noise", type=float, default=-38); ap.add_argument("--min", type=float, default=0.25)
    ap.add_argument("--gap", type=float, default=0.35); ap.add_argument("--lang", default="ar"); ap.add_argument("--model", default="large-v3")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        isl = speech_islands([[0, 1], [2, 2.2], [3, 5]], 6, 0.35)
        assert isl == [[1, 3], [5, 6]], isl            # the 0.2 s breath at 2.0 merges, the 2 s pause splits
        print("selftest ok"); return
    err = subprocess.run(["ffmpeg", "-hide_banner", "-i", a.media, "-af", f"silencedetect=n={a.noise}dB:d={a.min}", "-f", "null", "-"],
                         capture_output=True, text=True, encoding="utf-8", errors="replace").stderr
    s = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", err)]; e = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", err)]
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", a.media], capture_output=True, text=True).stdout)
    isl = speech_islands(list(zip(s, e + [dur] * (len(s) - len(e)))), dur, a.gap)

    import numpy as np
    from faster_whisper import WhisperModel
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", a.media, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True, check=True).stdout
    audio = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768
    model = WhisperModel(a.model, device="cpu", compute_type="int8")
    out = []
    for i, (t0, t1) in enumerate(isl):
        pad = 0.15                                                   # a little context so the first syllable is heard
        clip = audio[int(max(0, t0 - pad) * 16000):int(min(dur, t1 + pad) * 16000)]
        segs, _ = model.transcribe(clip, language=a.lang, condition_on_previous_text=False, vad_filter=False)
        text = " ".join(x.text.strip() for x in segs).strip()
        out.append({"i": i, "start": round(t0, 3), "end": round(t1, 3), "text": text})
        print(f"{i:3d} {t0:7.2f}-{t1:7.2f} ({t1 - t0:4.1f}s) {text}", flush=True)
    json.dump({"source": a.media, "islands": out}, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()

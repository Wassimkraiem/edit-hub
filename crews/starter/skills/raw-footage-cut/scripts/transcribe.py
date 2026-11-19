"""Word-level transcript of any audio/video with faster-whisper.

usage: python -I transcribe.py <media> <out.json> [--model large-v3] [--lang ar] [--from S] [--to E]
Writes <out.json> {language, words:[{t,s,e}]} and <out.txt> with one timed line per segment.
Times are on the SOURCE timeline even when --from/--to pick a slice.
"""
import argparse, json, subprocess, sys
import numpy as np
from faster_whisper import WhisperModel

sys.stdout.reconfigure(encoding="utf-8")  # python -I ignores PYTHONIOENCODING; Arabic would crash cp1252

ap = argparse.ArgumentParser()
ap.add_argument("media"); ap.add_argument("out")
ap.add_argument("--model", default="large-v3"); ap.add_argument("--lang", default=None)
ap.add_argument("--from", dest="start", type=float, default=0.0); ap.add_argument("--to", dest="end", type=float, default=None)
a = ap.parse_args()

# Decode with ffmpeg to 16 kHz mono: PyAV in this install is broken, and a wrong sample
# rate makes Whisper hallucinate ("شكرا للمشاهدة", "اشتركوا في القناة").
cmd = ["ffmpeg", "-v", "error", "-ss", str(a.start)] + (["-to", str(a.end)] if a.end else []) + \
      ["-i", a.media, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"]
audio = np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, np.int16).astype(np.float32) / 32768

model = WhisperModel(a.model, device="cpu", compute_type="int8")
segs, info = model.transcribe(audio, language=a.lang, word_timestamps=True, condition_on_previous_text=False)
words, lines = [], []
for s in segs:
    lines.append(f"[{s.start + a.start:7.2f}-{s.end + a.start:7.2f}] {s.text.strip()}")
    words += [{"t": w.word.strip(), "s": round(w.start + a.start, 2), "e": round(w.end + a.start, 2)} for w in s.words]
json.dump({"language": info.language, "words": words}, open(a.out, "w", encoding="utf-8"), ensure_ascii=False)
open(a.out.rsplit(".", 1)[0] + ".txt", "w", encoding="utf-8").write("\n".join(lines))
print(f"lang={info.language}"); print("\n".join(lines))

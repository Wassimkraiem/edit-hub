"""Cut a raw talking-head + voice-over recording from an edit decision list.

usage: python -I cut.py <edl.json> <out_dir> [--selftest]

edl.json:
{
  "source": "C:/path/raw.MOV",
  "silence": {"noise_db": -35, "min": 0.12, "pad": 0.03},   # optional, these are the defaults
  "timeline": [
    {"type": "talking_head", "name": "hook", "start": 4.90, "end": 10.35, "tighten": false},
    {"type": "voice_over", "name": "body", "segments": [[22.0, 27.5], [29.9, 49.72]]},
    {"type": "talking_head", "name": "cta", "start": 169.35, "end": 172.0}
  ]
}
Writes NN_<name>.mp4 per talking head, NN_<name>.wav per voice-over block, a draft
00_draft_assembly.mp4 (black frames under voice-over, for B-roll), and edit-decisions.json.
Voice-over is always tightened: every pause >= silence.min shrinks to 2 x pad.
"""
import json, re, subprocess, sys

def ffmpeg(args): subprocess.run(["ffmpeg", "-v", "error", "-y"] + args, check=True)

def silences(src, noise_db, min_len):
    log = subprocess.run(["ffmpeg", "-hide_banner", "-i", src, "-vn", "-af", f"silencedetect=n={noise_db}dB:d={min_len}",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    return list(zip(map(float, re.findall(r"silence_start: ([\d.]+)", log)), map(float, re.findall(r"silence_end: ([\d.]+)", log))))

def speech_pieces(segments, sil, pad):
    """Split each [a,b] at silences, keeping `pad` of air on each side of every cut."""
    out = []
    for a, b in segments:
        cur = a
        for s, e in sil:
            if e <= a or s >= b: continue
            if e >= b: break  # trailing silence: keep up to the hand-picked end, quiet last words live there
            if s - pad > cur + 0.02: out.append((cur, s + pad))
            cur = max(cur, e - pad)
        if b - cur > 0.02: out.append((cur, b))
    assert all(y > x for x, y in out), out
    return out

def selftest():
    sil = [(1.0, 2.0), (3.0, 3.5), (4.9, 6.0)]
    assert speech_pieces([(0.5, 5.0)], sil, 0.03) == [(0.5, 1.03), (1.97, 3.03), (3.47, 5.0)]
    assert speech_pieces([(1.2, 1.8)], sil, 0.03) == [(1.2, 1.8)]  # hand-picked span kept even if quiet
    print("selftest ok")

if "--selftest" in sys.argv: selftest(); sys.exit()

edl = json.load(open(sys.argv[1], encoding="utf-8")); out = sys.argv[2]
src = edl["source"]; cfg = {"noise_db": -35, "min": 0.12, "pad": 0.03, **edl.get("silence", {})}
probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                   "stream=width,height,r_frame_rate", "-of", "json", src], capture_output=True, text=True).stdout)["streams"][0]
W, H = probe["width"], probe["height"]; num, den = map(int, probe["r_frame_rate"].split("/")); fps = round(num / den, 3)
sil = silences(src, cfg["noise_db"], cfg["min"])
enc = ["-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]

graph, labels, decisions = [], [], []
for i, item in enumerate(edl["timeline"], 1):
    tag = f"{i:02d}_{item['name']}"
    if item["type"] == "talking_head":
        span = [(item["start"], item["end"])]
        pieces = speech_pieces(span, sil, cfg["pad"]) if item.get("tighten") else span
    else:
        pieces = speech_pieces(item["segments"], sil, cfg["pad"])
    for k, (x, y) in enumerate(pieces):
        graph.append(f"[0:a]atrim={x:.3f}:{y:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st={y-x-0.01:.3f}:d=0.01[a{i}_{k}]")
        if item["type"] == "talking_head":
            graph.append(f"[0:v]trim={x:.3f}:{y:.3f},setpts=PTS-STARTPTS,fps={fps},format=yuv420p,setsar=1[v{i}_{k}]")
    n = len(pieces); dur = sum(y - x for x, y in pieces)
    if item["type"] == "talking_head":
        graph.append("".join(f"[v{i}_{k}][a{i}_{k}]" for k in range(n)) + f"concat=n={n}:v=1:a=1[V{i}][A{i}]")
    else:
        graph.append("".join(f"[a{i}_{k}]" for k in range(n)) + f"concat=n={n}:v=0:a=1[A{i}]")
        graph.append(f"color=black:s={W}x{H}:r={fps}:d={dur:.3f},format=yuv420p,setsar=1[V{i}]")
    labels.append(i); decisions.append({**item, "file": tag, "pieces": pieces, "seconds": round(dur, 2)})

# one pass: split every block so it lands both in its own file and in the draft
outs = []
for i, d in zip(labels, decisions):
    graph.append(f"[V{i}]split[Vd{i}][Vf{i}]"); graph.append(f"[A{i}]asplit[Ad{i}][Af{i}]")
    if d["type"] == "talking_head":
        outs += ["-map", f"[Vf{i}]", "-map", f"[Af{i}]"] + enc + [f"{out}/{d['file']}.mp4"]
    else:
        graph.append(f"[Vf{i}]nullsink")
        outs += ["-map", f"[Af{i}]", "-c:a", "pcm_s16le", f"{out}/{d['file']}.wav"]
graph.append("".join(f"[Vd{i}][Ad{i}]" for i in labels) + f"concat=n={len(labels)}:v=1:a=1[DV][DA]")
outs += ["-map", "[DV]", "-map", "[DA]"] + enc + [f"{out}/00_draft_assembly.mp4"]
open(f"{out}/.graph.txt", "w").write(";\n".join(graph))
ffmpeg(["-i", src, "-filter_complex_script", f"{out}/.graph.txt"] + outs)
json.dump({"source": src, "silence": cfg, "timeline": decisions}, open(f"{out}/edit-decisions.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for d in decisions: print(f"{d['file']:<28} {d['seconds']:6.2f}s  {len(d['pieces'])} pieces")
print("draft", round(sum(d["seconds"] for d in decisions), 2), "s")

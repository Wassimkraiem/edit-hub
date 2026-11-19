---
name: raw-footage-cut
description: Cut a raw phone recording (talking head mixed with voice-over, with retakes and false starts) into the clean, snappy pieces for an edit. Picks the on-camera takes, keeps the best take of every repeated line, removes false starts and stutters, shrinks every pause to a breath, and outputs talking-head clips, a tight voice-over WAV and a draft assembly. Use when the user gives raw footage (any language, incl. Tunisian Arabic) and asks to cut it, find the talking heads, clean the voice-over, remove silences or repeats, or make it fast.
---

# Raw footage cut

Method from herk-edit-kit (cut-silences + cut-mistakes): transcribe word by word, keep the
clean take of every retake, cut dead air, verify by re-transcribing. Scripts live in
`<SKILL_DIR>/scripts/`. Needs `ffmpeg`/`ffprobe` and Python with `faster-whisper` + `numpy`.
Work in the scratchpad; write deliverables next to the source in `<source-stem>_cuts/`.
Always run Python with `-I` and pass paths as arguments.

## 1. Probe and find where the face is on camera

```bash
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height,r_frame_rate -of json "$SRC"
ffmpeg -v error -y -i "$SRC" -vf "fps=1/10,scale=180:-1,tile=10x2" -frames:v 1 sheet.jpg      # overview
ffmpeg -v error -y -ss <from> -t 20 -i "$SRC" -vf "fps=1,scale=108:-1,tile=10x2" -frames:v 1 a.jpg   # 1 frame/s at a boundary
```

Read the images. Face visible = talking-head candidate; camera turned away / off-frame =
voice-over (only the audio is used). Do **not** use `drawtext` on Windows: it segfaults
without fontconfig. If the user gave a script and says which lines are on camera, that wins.

## 2. Transcribe (word timestamps)

```bash
python -I "<SKILL_DIR>/scripts/transcribe.py" "$SRC" transcript.json --lang ar
python -I "<SKILL_DIR>/scripts/transcribe.py" "$SRC" end.json --lang ar --from 140   # re-run a garbled region
```

`large-v3` is the default (accurate on Tunisian/Arabic-French code-switching; `--model medium`
is faster but garbles). Leave `--lang` out to auto-detect. If the output says
"شكرا للمشاهدة" / "اشتركوا في القناة" / "موسيقى", Whisper is hallucinating on bad input.
Word `s` times often swallow the pause before the word, so snap cuts to silences (step 4).

## 3. Decide the takes (judgment, the review gate)

Read the transcript in order and mark:
- **Retakes**: the same line said 2+ times → keep the **last complete, clean** take.
- **False starts**: a phrase that stops and restarts ("ومن هك ومن record هيك") → cut the abandoned part.
- **Stutters** ("the the", "اسمها اسمها") → keep one. Emphatic repetition is not a mistake.
- **Talking heads**: the on-camera lines. A long on-camera take with a long pause inside can be
  split into two talking-head clips (that is how "3 cuts" usually appears).

If the user gave a script, match every script line to exactly one kept span. Otherwise show
the take choices in a table and say which ones you were unsure about.

## 4. Snap to silences and write the EDL

```bash
ffmpeg -hide_banner -i "$SRC" -af silencedetect=n=-32dB:d=0.3 -f null - 2>&1 | grep -o 'silence_\(start\|end\): [0-9.]*' | paste - -
ffmpeg -hide_banner -i "$SRC" -af volumedetect -f null - 2>&1 | grep mean_volume
```

Span start = end of the silence before the first word − 0.1 s; span end = start of the
silence after the last word + 0.15 s. Set `silence.noise_db` about 3 dB below `mean_volume`
(−35 for a −32 dB mean). Write `edl.json`:

```json
{
  "source": "C:/Users/.../raw.MOV",
  "silence": {"noise_db": -35, "min": 0.12, "pad": 0.03},
  "timeline": [
    {"type": "talking_head", "name": "talking_head_hook", "start": 4.90, "end": 10.35},
    {"type": "voice_over", "name": "voice_over", "segments": [[22.0, 27.5], [29.9, 49.72], [53.0, 57.35]]},
    {"type": "talking_head", "name": "talking_head_cta_1", "start": 169.35, "end": 172.0},
    {"type": "talking_head", "name": "talking_head_cta_2", "start": 178.05, "end": 184.85}
  ]
}
```

Timeline order = final video order. Voice-over is always tightened (every pause ≥ `min`
shrinks to `2 × pad`, about 60 ms, which is snappy). Add `"tighten": true` to a talking head to
jump-cut its pauses too. Raise `pad` to 0.05 if the result feels breathless.

## 5. Cut

```bash
python -I "<SKILL_DIR>/scripts/cut.py" --selftest
python -I "<SKILL_DIR>/scripts/cut.py" edl.json "<out_dir>"
```

Outputs `NN_<name>.mp4` (talking heads, original framing and audio), `NN_<name>.wav`
(tight voice-over), `00_draft_assembly.mp4` (black frames under the voice-over for B-roll), and
`edit-decisions.json` (every kept piece, so any cut can be moved).

## 6. Verify (required)

```bash
python -I "<SKILL_DIR>/scripts/transcribe.py" "<out_dir>/00_draft_assembly.mp4" check.json --lang ar
```

Check every line appears once, in order, nothing repeated and no ending cut off. A quiet last
word ("انتي") gets eaten when its span end sits before it; extend that span end by 0.1–0.2 s and
re-cut. Then report: the take table, the length before and after, the output paths, and that the joins
were checked by transcript, not by ear.

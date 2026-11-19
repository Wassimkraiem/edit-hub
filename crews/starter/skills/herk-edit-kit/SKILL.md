---
name: herk-edit-kit
description: Nate Herk's transcript-driven cut pipeline (github.com/nateherkai/herk-edit-kit, MIT) for talking-head recordings - cut-silences (keeps a natural breath at every join), cut-mistakes (stutters, false starts, retakes, review-gated), reviewed cut rendering and an EDL review page. Use when a raw phone recording must be cut clean: "cut the silences / fillers / mistakes / repeats", "keep the clean take", or herk-edit-kit by name.
---

# Herk edit kit (cut pipeline)

Source: github.com/nateherkai/herk-edit-kit (MIT, © 2026 Nate Herk, see LICENSE). Bundled with Edit Hub: the cut stages
(`kit/skills/cut-silences`, `kit/skills/cut-mistakes`), `scripts/` and `docs/` (editing playbook, short-form notes). The
kit's motion-graphics parts are not included: the look comes from the user's own style skill. Node scripts use only
built-ins; run them from this skill's folder. Transcription uses the `raw-footage-cut` skill's `transcribe.py`.

## Rules (they override the kit's defaults)
1. **The voice matches the script.** When a script exists, every kept span is a line the speaker actually said, in
   script order, with the last clean take of each. Drop asides, fillers, restarts and lines that are not in the script.
   A script line that was never said is reported, never faked. Without a script, the transcript the user approved is
   the reference.
2. **Natural joins.** Keep the kit's breath at every join (0.14–0.24 s), never a hard zero gap. No word may be clipped.
3. **Cut at pauses, never on raw Whisper word times.** Whisper on a whole take merges retakes into one stretched word
   and drops restarts, so it cannot pick takes: split at measured silences first (the island method below).
4. Cut first, render a check video with the transcript burned in, and wait for the user's OK before any styling.

## Pipeline (island method, use this)
1. `python -I scripts/islands.py raw.MOV <proj>/islands.json`: splits at measured silences (−38 dB, ≥ 0.25 s; pauses
   under 0.35 s stay inside an island) and transcribes every island alone. Hallucinated outros ("thanks for watching",
   "subscribe") on silence are noise: drop them.
2. Pick the kept islands in script order (the last clean take of each line). Trim an island only at a real pause inside
   it or right before a restart; for a trim, get exact word times with `transcribe.py --from/--to` on a 3 s window.
   Write `<proj>/keep.json` = `{words:[{text, start, end, island}]}` (one "word" per kept island).
3. `node kit/skills/cut-silences/scripts/cut-silences.mjs <proj>/keep.json --gap 0.3 --video raw.MOV --apply --output <proj>/edited-clean.mp4`:
   everything not kept falls in a gap and goes; every join keeps the kit's breath.
4. Verify in short windows (`transcribe.py edited-clean.mp4 --from/--to`): a whole-file pass on the cut drops words it
   can hear. Every line once, in order, nothing extra, the first and last word of every span intact.

## Pipeline (word method, the kit's original, for reference)
1. Transcribe with local Whisper (`transcribe.py raw.MOV raw.whisper.json`), then `node scripts/snap-words.mjs
   raw.whisper.json raw.MOV raw.json` (trims each word to the speech side of any silence inside it).
2. Silences: `node kit/skills/cut-silences/scripts/cut-silences.mjs raw.json --out-dir <proj>` (gap 0.55, head 0.22, tail 0.34).
3. Mistakes: `node kit/skills/cut-mistakes/scripts/find-cut-candidates.mjs <proj>/raw.silence-transcript.json --out-dir <proj>`,
   then read every line against the script (rule 1). Write `approved-cuts.json` (`{cuts:[{start,end,reason}]}`).
4. Render: `cut-silences.mjs ... --video raw.MOV --apply --output <proj>/edited-silenced.mp4`, then `node
   kit/skills/cut-mistakes/scripts/apply-cuts.mjs <proj>/raw.silence-transcript.json --cuts approved-cuts.json --video
   <proj>/edited-silenced.mp4 --output <proj>/edited-clean.mp4 --apply`.
5. Review page (optional): `node scripts/build-edl-review.mjs <stem>.mistakes-edl.json --original ... --edited ... --output review.html`.

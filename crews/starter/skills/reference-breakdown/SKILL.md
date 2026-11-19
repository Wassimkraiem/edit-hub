---
name: reference-breakdown
description: Take a reference video (a link or a file) apart - its script as spoken, every scene and frame, the UI and resources shown, each animation described precisely, and what makes it work - so the writer can write the user's version and the editor can rebuild the scenes without watching the original again. Use whenever the user shares a video to study, clone or take ideas from.
---

# Reference breakdown

Write everything into `<workspace>\analyses\<short-name>\`.

## 1. Get the video
- A link: download it with yt-dlp (best quality with sound, mp4) into `<workspace>\analyses\<short-name>\source.mp4`, and keep the page's own text (title, caption, author, date, views) in `source.json`. A login wall or a private video: stop and say so; never use anyone's credentials.
- A file: copy it there; never edit the original.
- Probe it with ffprobe: length, size (9:16 or 16:9), frame rate.

## 2. Transcript (the script as spoken)
- Transcribe with faster-whisper (large-v3, word timings) on the GPU; keep `transcript.json` (words with start/end) and `transcript.md` (lines with timecodes).
- Note the language(s), the speaking speed (words per minute) and whether it is on-camera, voice-over or captions only.
- Text that only appears on screen (titles, captions) goes in the scene breakdown, not in the transcript.

## 3. Scenes and frames
- Find every cut with ffmpeg scene detection (`select='gt(scene,0.3)'`, lower it for a fast edit) and check the list against the transcript.
- Export one frame per scene plus one at every big change inside a scene into `frames/` (`<scene>-<seconds>.jpg`), and a contact sheet (`contact-sheet.jpg`, ffmpeg tile).
- Look at the frames yourself (Read the images); never describe a frame you have not looked at.

## 4. The breakdown (`analysis.md`)
For the whole video: format, length, the hook (first 3 s, word for word, and what is on screen), the beat structure (each beat with its timecode and its job: hook, proof, value, call to action), pacing (cuts per minute, average shot length), the look (palette with hex values picked from the frames, fonts or the closest match, layout grid, safe zones), the music and sound design (beds, whooshes, hits, UI ticks: where and why).
Then one block per scene:
- **Time**: start-end, the words spoken over it.
- **On screen**: what we see, the text shown (exactly), the layout.
- **UI and resources**: every app, website, tool, logo, screenshot, product, chart or stock clip shown, named precisely (e.g. "Claude Code terminal, dark theme", "GitHub repo page of X", "Notion database"), and what we would need to show the same thing (a real screenshot of which page, a screen recording of which action, a logo file).
- **Animation**: what moves, from where to where, how long, the easing (ease-out, spring, linear), the order and overlaps, transitions in and out (cut, whip, zoom, mask, morph), camera moves (push-in, pan, shake), text animation (per word, per letter, typewriter, highlight). Write it so an animator can build it: start and end states, durations in seconds, the easing.
- **Sound**: the effects on this scene and what they hit.

End with **What makes it work** (3 to 5 points), **What to take for the user** (what fits the user's own styles) and a **Resource list** to gather before animating (screenshots, recordings, logos, music), each with where to get it.

## 5. Hand-off
Report: the folder, the length and format, the hook, the beat list, and the resource list. The Director then gives your transcript and beat sheet to the writer to write the user's script: give the writer the beats and timings, not a translation to copy. Never claim a number, a tool name or a feature you could not read or hear in the video: mark it "to check".


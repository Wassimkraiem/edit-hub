# Edit Hub

**Drop a raw recording, say what you want, get a finished video.** Edit Hub is a local app where you talk to a Director
(by voice or text) and a small crew of Claude Code agents cleans your footage, edits it in your own style, adds captions
and sound, and can post it to YouTube, Instagram and Facebook. Everything runs on your computer with your own Claude plan.

## What it does
- **First-run setup.** Checks what your computer needs, then helps you build your own style: colours, fonts and editing
  styles with a live preview, and a few questions about your channel. The Director turns your choices into a style skill.
- **A small crew that learns.** An editor (clean cuts, mistakes and silences removed, your style, captions, sound, its
  own quality check) and a writer (ideas, series, scripts, hooks). Every fix you make becomes a note they follow from
  then on.
- **Review before render.** Films are code (HTML) and play in a live preview with no render. Leave notes on frames, the
  editor fixes them, and you render when you are happy, one render at a time with CPU and memory protection.
- **Costs you can see.** Tokens and cost under every reply and for every agent, from Claude Code's own logs.
- **Pure Claude Code.** The Director is Claude Code: your skills, MCP servers, sub-agents, `/` commands, and a full
  terminal view (where the experimental Code Mode works).

## Install

You need a Claude Pro or Max plan, [Claude Code](https://claude.ai/install), Node.js 22.13 or later, ffmpeg and Google
Chrome (or Edge). Download this repository (Code → Download ZIP, or `git clone`), then:

**Windows:** double-click `SETUP.cmd`. To install the tools first:

```
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id Gyan.FFmpeg
winget install -e --id Google.Chrome
```

**macOS** (with [Homebrew](https://brew.sh)), in Terminal from the downloaded folder:

```
brew install node ffmpeg
brew install --cask google-chrome
bash setup.sh
```

**Linux:** install Node 22.13+, ffmpeg and a native Chrome or Chromium from your distribution, then `bash setup.sh`.

Setup makes your workspace (`Documents/EditHub`), connects Edit Hub to Claude Code, and puts an **EditHub** shortcut on
your Desktop. Open it and the welcome steps start. On macOS the Desktop `EditHub.command` briefly opens Terminal; if
macOS blocks it the first time, allow it in System Settings → Privacy & Security → Open Anyway.

To post your videos, install the [Claude in Chrome](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn)
extension, sign in with the same Claude account, and run `claude --chrome` once.

## Status
- Windows is the main platform. macOS and Linux support is new and has not been tested on real machines yet: please
  open an issue with anything that breaks.
- Written in TypeScript with no build step: Node strips the types as files load. The installer stays plain JavaScript
  so it runs on any Node 22. `npm test` runs the tests and the type check; 59 files are not type-checked yet (they start
  with `// @ts-nocheck`).
- How it all fits together: `docs/edit-hub-architecture.html`.

## Credits
Based on [VideoHub](https://github.com/TensaikunYT/Videohub) by its contributors (MIT). The cut pipeline in the starter
crew is [herk-edit-kit](https://github.com/nateherkai/herk-edit-kit) by Nate Herk (MIT, licence in its folder).

## Licence
MIT. See `LICENSE`.

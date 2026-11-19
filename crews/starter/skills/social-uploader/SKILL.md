---
name: social-uploader
description: Upload and schedule a finished video (any size, including over 10 MB) on YouTube (Studio) and Facebook + Instagram (Meta Business Suite) at a given date and time, by driving the user's own signed-in Chrome with Claude in Chrome and each site's own scheduler. Use when the user says "schedule this video", "post it at 7:30", "put it on YouTube and Instagram", or an edit is finished and they give a date. Not for editing video or writing captions from nothing.
---

# Social uploader (Chrome, the platforms' own schedulers)

Uploads a local video to YouTube Studio and Meta Business Suite in the user's own Chrome and uses each site's own
scheduler. No API keys, no third-party scheduler, no post limits. Needs Claude in Chrome (Edit Hub's Requirements page
checks it) and the user signed in to those sites in that browser.

## Hard rules
- **The right browser and account.** Before any upload, open the site and check the account name shown in the page
  matches the channel the user named (`channel.md` lists them). If no browser is connected, or it shows another
  account, stop and say so; never upload to a channel you have not confirmed.
- Never click YouTube **Publish** (it posts publicly now). Only **Schedule**.
- Time zone: the one in `channel.md` (ask once and save it there if missing). Resolve "today/tomorrow" against today.
- Show the channels, title, caption and time once and wait for OK, unless the user already gave exact copy and time and
  said to go ahead.
- Batch browser actions; do not ask what you can check.

## 1. Prepare
- Inputs: the video path, date and time, channels (default: the ones in `channel.md`), the copy.
- Copy: use the user's text as written. Without one, write it in the channel's voice (`channel.md`, `brand.md`) from the
  video's transcript.

## 2. The relay (files over 10 MB)
Claude in Chrome's file upload is capped at 10 MB. The relay hands the file to the page instead. Start it in the
background from this skill's folder (it serves files from that one folder only, on 127.0.0.1:8765):

```bash
node scripts/serve.js "<folder containing the video>"
```

In the site tab, add a button, click it with the extension (a real click, or the popup is blocked), then await the file:

```js
window.__relay = new Promise((res, rej) => { addEventListener("message", e => { if (e.origin === "http://127.0.0.1:8765" && e.data?.relay) e.data.file ? res(e.data.file) : rej(e.data.error) }); setTimeout(() => rej("timeout"), 60000) });
const b = document.createElement("button"); b.id = "__relaybtn"; b.textContent = "RELAY";
b.style.cssText = "position:fixed;top:10px;left:10px;z-index:2147483647;padding:20px;background:red;color:#fff";
b.onclick = () => window.open(`http://127.0.0.1:8765/relay.html?f=<FILE NAME>&o=${encodeURIComponent(location.origin)}`, "_blank");
document.body.appendChild(b);
```

Find the RELAY button, click it, then in the next call `await window.__relay` (a File). End every statement with `;`.
Stop the relay when done.

## 3. YouTube
1. Open `https://studio.youtube.com` → Create → Upload videos. Add the relay button, click it, then:
   ```js
   const f = await window.__relay; const input = [...document.querySelectorAll('input[type=file]')].find(i => i.closest('ytcp-uploads-file-picker'));
   const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files; input.dispatchEvent(new Event('change', {bubbles: true})); document.getElementById('__relaybtn')?.remove();
   ```
2. Details: set the title and description with focus + `document.execCommand('selectAll')` + `document.execCommand('insertText', false, text)`
   on `#title-textarea #textbox` and `#description-textarea #textbox`. Choose "No, it's not made for kids". Title ≤ 100
   characters; add `#shorts` for vertical videos.
3. Next three times, then **Schedule**: pick the day in the calendar and the time (15-minute steps); zoom to check the
   date, time and time zone. Click Schedule and keep the link it shows.

## 4. Meta (Facebook + Instagram in one post)
1. Open `https://business.facebook.com/latest/reels_composer`. Add the relay button, click it, then arm a one-shot
   file-picker intercept and click "Add video":
   ```js
   const f = await window.__relay; window.__relayFile = f;
   const orig = HTMLInputElement.prototype.click;
   HTMLInputElement.prototype.click = function () {
     if (this.type === "file" && window.__relayFile) { HTMLInputElement.prototype.click = orig;
       const dt = new DataTransfer(); dt.items.add(window.__relayFile); this.files = dt.files;
       this.dispatchEvent(new Event("input", {bubbles: true})); this.dispatchEvent(new Event("change", {bubbles: true})); return; }
     return orig.call(this); };
   ```
   Check both Facebook and Instagram are selected.
2. Caption: click the caption box and type with the `type` action only, one paragraph at a time, `shift+Enter` twice
   between paragraphs, hashtags last, then `Escape`. Never `execCommand('insertText')` with newlines here (the editor
   scrambles it). Check the box's `innerText`. Next, Next.
3. The Share step's button posts now: first open the **Schedule** tab, set the date and the time for each row, zoom to
   check, then Schedule. Expect "Reel scheduled … on Facebook and … Instagram".

## 5. Verify, clean up, report
- YouTube Studio's Content (Shorts tab for vertical videos) shows the title as **Scheduled** with the date; Meta's
  content calendar shows both items at that time.
- Stop the relay, close the tabs you opened, delete any scratch copy of the video.
- Report a table: platform, account, status, where you checked. Say what you could not check.

## Dead ends (do not retry)
TikTok Studio (its page blocks the relay). Fetching 127.0.0.1 straight from the site (blocked by the site's security
policy). The browser's native file dialog. Third-party schedulers with 10 MB caps.

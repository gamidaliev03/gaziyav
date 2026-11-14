# The browser edition

[← Manual](README.md)

<img src="../../../assets/screens/en/t-web.jpg" width="100%" alt="Gaziyav in a browser tab: the sample project on the timeline, Media, the player and the inspector">

**What it is for.** Gaziyav on every computer that is not a Mac — Windows, Linux, a Chromebook — on a phone or a tablet, or on a Mac where you cannot install anything.

**How.** Open `https://gamidaliev03.github.io/gaziyav/editor/`. Nothing to install, no account, no server: it runs on your own hardware, your files never leave the tab, and after the first open it works offline. When a new version of the site is out, the page picks it up by itself; if you are already at work, a small **A new version is ready — reload** button waits for you instead.

**What it has.**
- The timeline and its grammar, titles, effects, transitions, filters, [generators](generators.md), looks, import of your own files and export.
- **Sounds:** the site's own sound pack (Audio → Sound effects) and your own sounds.
- **Captions from speech** and **Remove pauses**. The open Whisper speech model runs in the page: it is downloaded once from Hugging Face (about 300 MB on a computer, about 140 MB on a phone) and the sound never leaves the tab.
- **AI image, AI video and lipsync (beta) on your own fal.ai key** (the AI tab): the price is shown before anything runs; the key stays in this browser and goes only to fal.ai.
- **A layout for phones and tablets:** the player, full-width tracks and a bottom bar — **Add · Edit · Text · Audio · Filters · Format**. Each opens a sheet; with a clip selected, **Edit** has its quick actions (split, delete, duplicate, speed, reverse, freeze, mute). Undo, play and redo sit above the timeline; **Format** sets 9:16, 4:5, 1:1 or 16:9.
- Auto colour: the clip's right-click menu or **More tools** in the timeline toolbar.
- The inspector lists only what works in a browser ([The inspector](inspector.md)).

**Only in the Mac app.** Claude inside Gaziyav; the other on-device AI tools (background removal, voice clean-up, retouch, upscale, stabilise and more); a clip by link; posting; a voice from text; motion graphics; long, heavy exports.

**Rules that surprise people.** Projects live in this browser's storage: clearing the site's data clears them. Export what you want to keep.

The tour as slides is on the same site: `https://gamidaliev03.github.io/gaziyav/tour/`.

# Privacy: what stays, what leaves, and when

**English** · [Русский](../ru/privacy.md)

Short version: **your projects and media never leave your computer unless you press a button that needs the internet** — and then only what that button needs goes, to the service named on it. There is no Gaziyav account, no Gaziyav server, no analytics and no crash reporting to anyone.

This page was written from the code, not from intentions. If you find a request it does not list, that is a bug — please [report it](https://github.com/gamidaliev03/gaziyav/issues/new?template=bug.yml).

## What stays on your computer

- **Projects, media, versions, voices and settings** — in `~/Library/Application Support/Gaziyav` on macOS. Imported files are copied (as APFS clones, which take no extra space) into the project.
- **Editing, playback, effects, titles, colour, export** — all computed locally.
- **Captions, voice clean-up, separating voice and music, the voice changer, object clean-up** — local models on your Mac.
- **Crash reports** stay on disk; the crash reporter is set never to upload.
- **Your keys** (fal.ai, kie.ai, ArgoLink, Pexels, Pixabay) — encrypted with the macOS Keychain, readable only by your user. The interface shows only the last four characters.

## What leaves, when, and where

| You… | What is sent | To |
|---|---|---|
| run lipsync | the trimmed clip's **speech spans** (re-encoded H.264), the sound to follow; for a clone, the voice sample | fal.ai (storage, then the model) |
| run voice, clone, a picture, video, face swap | the text, the sample, the reference picture or the clip piece that feature needs | fal.ai, or kie.ai / ArgoLink if you picked one of their models |
| use the agent, AI scripts or a dub's translation | the text of the request and the project facts it needs (names, lengths, the transcript when asked) | fal.ai's OpenRouter endpoint → the model you chose |
| import by link | the link (and the site's normal requests) | the site, through yt-dlp |
| use the link downloader for the first time, or YouTube starts failing | a check for a newer yt-dlp — accepted only if signed by yt-dlp's own key, at most once a day | github.com (yt-dlp's releases) |
| open a feature whose local model is not there yet | a download request | Hugging Face (fallback hf-mirror.com) or the model's original publisher; every file is checked by size and SHA-256 |
| search stock video | your search words | Pexels / Pixabay (with your keys) and Wikimedia Commons |
| use motion graphics that need the renderer for the first time | a one-time download of a headless renderer (pinned version, SHA-256 checked) | Google's Chrome for Testing storage |
| post | your exported video | the platform's own page, in a window where you signed in yourself |

What the AI providers do with what they receive is set by their own terms: [fal.ai](https://fal.ai), and kie.ai / ArgoLink if you use them.

## Lipsync, in detail

Only the parts where somebody speaks are sent — never the silence, never the rest of the project. The clip is re-encoded here to 8-bit 4:2:0 H.264, BT.709 SDR, at high quality. When the answer comes back, Gaziyav takes only the face region from it and composites it onto your original frames; outside that region your original pixels are kept exactly. [More →](lipsync.md#what-leaves-your-computer)

## The browser edition

[Gaziyav in your browser](https://gamidaliev03.github.io/gaziyav/editor/) is a static page: there is no server behind it, only the files GitHub Pages serves.

- **Your media is never uploaded.** Files you open are read by the page inside your browser tab and stay there.
- **Projects** are stored in that browser's own storage on your computer (IndexedDB, local storage). Clearing the site's data in the browser deletes them — export what you want to keep.
- **After the first open** the editor's files are cached by the browser, so it also works offline.
- **Lipsync (beta), with your own key:** the fal.ai key you paste is kept only in this browser's storage and is sent only to fal.ai, with the clip piece and the sound, when you press the button. Nobody else — not this site, not GitHub — receives it.

## What Gaziyav never does

- No account, no sign-up, no e-mail.
- No analytics, no tracking pixels, no «anonymous usage statistics».
- No upload of your projects to any cloud.
- No watermark, no «AI-generated» stamp on your video.

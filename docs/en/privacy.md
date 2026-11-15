# Privacy: what is sent, where and when

**English** · [Русский](../ru/privacy.md)

In short: **your projects and media stay on your computer.** Something is sent only when you use a feature that needs the internet, and then only what that feature needs, to the service it names. There is no Gaziyav account, no Gaziyav server, no analytics, no usage statistics and no crash reporting.

This page is written from the code. If you find a request it does not list, please [report it](https://github.com/gamidaliev03/gaziyav/issues/new?template=bug.yml) as a bug.

## What stays on your computer

- **Projects, media, versions, voices and settings**: in `~/Library/Application Support/Gaziyav` on macOS. Imported files are copied into the project as APFS clones, which take no extra space.
- **Editing, playback, effects, titles, colour, export**: all computed locally.
- **Captions, voice clean-up, separating voice and music, the voice changer, object clean-up**: local models on your Mac.
- **Library tracks and sounds** you have used: kept in a cache on your disk.
- **Crash reports** stay on disk; the crash reporter is set never to upload.
- **Your keys** (fal.ai, kie.ai, ArgoLink, Pexels, Pixabay): encrypted with the macOS Keychain, readable only by your user. The app shows only their last four characters.

## What leaves, when, and where

| You… | What is sent | To |
|---|---|---|
| run lipsync | the **speech parts** of the trimmed clip (re-encoded H.264) and the sound to follow; for a clone, the voice sample | fal.ai (storage, then the model) |
| run voice, clone, a picture, video, face swap | the text, the sample, the reference picture or the clip piece that feature needs | fal.ai, or kie.ai / ArgoLink if you picked one of their models |
| use the agent, AI scripts or a dub's translation | the text of the request and the project facts it needs (names, lengths, the transcript when asked) | fal.ai's OpenRouter endpoint → the model you chose |
| import by link | the link (and the site's normal requests) | the site, through yt-dlp |
| use the link downloader for the first time, or YouTube starts failing | a check for a newer yt-dlp, accepted only if signed by yt-dlp's own key, at most once a day | github.com (yt-dlp's releases) |
| use a library track or sound for the first time | a download request | the author's Hugging Face; Mixkit items from mixkit.co; every file checked by SHA-256 |
| open a feature whose local model is not there yet | a download request | Hugging Face, mostly the author's model repository (fallback hf-mirror.com), a few files from the model's original publisher; every file checked by size and SHA-256 |
| search stock video | your search words | Pexels / Pixabay (with your keys) and Wikimedia Commons |
| use motion graphics that need the renderer for the first time | a one-time download of a headless renderer (pinned version, SHA-256 checked) | Google's Chrome for Testing storage |
| post | your exported video | the platform's own page, in a window where you signed in yourself |

What the AI providers do with what they receive is set by their own terms: [fal.ai](https://fal.ai), and kie.ai / ArgoLink if you use them.

## Lipsync

Only the parts where somebody speaks are sent, never the silence or the rest of the project. Gaziyav takes only the face region from the answer and keeps your original pixels everywhere else. Details: [Lipsync → What leaves your computer](lipsync.md#what-leaves-your-computer).

## The browser edition

[Gaziyav in your browser](https://gamidaliev03.github.io/gaziyav/editor/) is a static page: there is no server behind it, only the files GitHub Pages serves.

- **Your media is never uploaded.** The page reads the files you open inside your browser tab, and they stay there.
- **Projects** are stored in that browser's own storage on your computer (IndexedDB, local storage). Clearing the site's data in the browser deletes them, so export what you want to keep.
- **After the first open** the browser caches the editor's files, so it also works offline.
- **Music and sounds:** each file downloads from the author's Hugging Face (Mixkit items from mixkit.co) the first time you use it, then stays in this browser.
- **Captions from speech:** on the first «Generate» the page downloads the open Whisper speech model from Hugging Face (a download; nothing is sent there) and recognises the speech itself, inside the tab.
- **Lipsync (beta), AI image and AI video on your own key:** the fal.ai key you paste is kept only in this browser's storage and is sent only to fal.ai, with what the job needs (the clip piece and the sound for lipsync; the description and the pictures you picked for a generation), and only when you press the button. Nobody else receives it, not this site and not GitHub.

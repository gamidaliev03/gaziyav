# Captions

[← Manual](README.md)

**What it is for.** Captions from the speech in your clips, timed word by word. Recognition runs on your Mac and is free.

**How.**
1. **Text** tab → **Captions** → **Auto captions**.
2. Spoken language (or Auto detect), words per line, bilingual captions if you want a second language under the first.
3. **Generate**. Tick «Delete current captions» to replace captions made earlier.

Also in the tab: **Templates** (caption styles), **Auto lyrics** for songs, **Add captions** by hand, and **Remove pauses**, which cuts silences and filler words out of the selected talking clip.

**Good to know.**
- The first run downloads the speech model (574 MB) once from Hugging Face and checks it by SHA-256. After that, captions work offline.
- Remove pauses shortens pauses longer than 400 ms to the speaker's natural pause, not to zero. It cuts inside the silence, never through a word or a breath, adds 30 ms fades at the joins and keeps linked sound in sync. Captions and titles move with the cuts; music is not cut.
- One <kbd>⌘Z</kbd> takes the whole pass back.

**Limits.** Speech recorded in a noisy room is recognised worse. Clean the voice first ([Sound](sound.md)).

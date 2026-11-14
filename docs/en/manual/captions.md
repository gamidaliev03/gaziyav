# Captions

[← Manual](README.md)

**What it is for.** Word-timed captions from the speech of your clips — recognised on your Mac, free.

**How.**
1. **Text** tab → **Captions** → **Auto captions**.
2. Spoken language (or Auto detect), words per line, bilingual captions if you want a second language under the first.
3. **Generate**. Tick «Delete current captions» to replace an earlier pass.

Also in the tab: **Templates** (caption styles), **Auto lyrics** for songs, **Add captions** by hand, and **Remove pauses** — cuts the silences and filler words of the selected talking clip.

**Rules that surprise people.**
- The first run fetches the speech model once (574 MB) from Hugging Face, checked by SHA-256; after that it works offline.
- Remove pauses shortens long pauses (over 400 ms) to the speaker's natural pause rather than to nothing, cuts inside the silence (never through a word or a breath), puts 30 ms fades at the joins, and keeps linked sound in sync. Captions and titles follow; music is not cut.
- One <kbd>⌘Z</kbd> takes the whole pass back.

**Limits.** Speech in noisy rooms is recognised worse: clean the voice first ([Sound](sound.md)).

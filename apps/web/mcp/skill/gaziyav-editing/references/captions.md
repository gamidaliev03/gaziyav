# Captions

`edit {ops:[{op:"captions", style, language?}]}` transcribes the speech on this Mac and places word-timed captions
on their own track (`language`: auto, or force `ru` / `en`). Styles: `find_content {kind:"caption"}`.

| Video | Style | Words on screen |
|---|---|---|
| Reels / TikTok / Shorts talk, ads | `hormozi` (bold, key word highlighted) or `word-pop` | 2–4 |
| Energetic, music-driven | `one-word`, `neon` | 1 |
| Calm talk, interview, education | `clean`, `karaoke` | 3–5 |
| YouTube 16:9 | `clean` (small, low) | 5–7 |
| Ads in Russian | `ad-golos-yellow`, `ad-montserrat-yellow` | 2–3 |

- One style per video; captions just above the platform's bottom bar (9:16: y ≈ 1200–1400 of 1920, i.e.
  `transform.positionY` +240…+440 from the centre). Move them all: `{op:"set", id:"captions", params:{"transform.positionY":"-=120"}}`.
- Reading speed ≤ 17 characters a second, at most 2 lines; nothing important under them.
- A wrong word: `{op:"set", id:<caption id>, params:{content:"…"}}`; names the recognizer mishears: fix them after.
- Check one captioned frame with `look`.

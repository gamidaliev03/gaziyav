# Free on-device AI

[← Manual](README.md)

**What it is for.** Everyday AI tools that run on your Mac: no key, no account, no charge per use.

**What there is.**

| Feature | What it does |
|---|---|
| Speech recognition | Captions from speech, removing pauses and filler words, word timing |
| Enhance voice | Removes noise, hum and room echo from a voice |
| Separate voice and music | Splits a clip's voice and music into two clips (a faster variant on Apple silicon; a beat checker for songs) |
| Voice changer | Voice effects on the clip's speech: telephone, walkie-talkie, deep, robot and others; no download |
| CleanUp | Removes an object, a person or a caption from a photo or a clip and fills in the background |
| Retouch | Sharper eyes and smoother skin; the face stays the person's own |
| Sound recognition for Claude | Lets [Claude](claude.md) ask how a stretch sounds and name what is heard |

Built in, nothing to install: remove or blur the background, enhance, upscale 2× / 4×, deflicker, auto colour, split into scenes, make vertical (keeping the face in frame), beat markers, tracking (blur or pixelate a moving face or object).

**How.**
- Settings → **AI** lists the features, each with its download size and the memory it needs. **Download** one, or **Download all**.
- Or just use a feature: the first time you need it, its model downloads in the background.
- On a clip, use the inspector: most tools are in its **AI** tab, voice tools in **Audio**, auto colour in **Color**, background removal in **Effects** ([The inspector](inspector.md)). They are also in the clip's menu, or ask [Claude](claude.md). A tool's result is an effect on the clip, switched on and off in its section, not a separate file in Media.

**Good to know.** Models download once from the author's page on Hugging Face (from the hf-mirror.com mirror when Hugging Face cannot be reached; a few from the model's original publisher). Every file is checked by SHA-256 and kept in the cache. After that the tools work offline.

**Limits.** Apple silicon Macs only. The heaviest tools need a lot of memory and are not offered on a Mac with less than 16 GB. The [browser edition](browser.md) has speech recognition (captions, remove pauses) with its own model; the other tools need the Mac app.

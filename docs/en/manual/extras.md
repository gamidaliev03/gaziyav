# Extras with your own key

[← Manual](README.md)

**Not needed to edit — here if you want it.** Gaziyav can call paid neural networks through your own [fal.ai](https://fal.ai) key: lipsync, a voice from text, a cloned voice, dubbing, pictures and video from text or a picture, face swap, and the in-app agent (Gaziyav AI) on a paid model.

## Set up

Settings → **AI** → paste your fal.ai key. It is stored encrypted in the macOS Keychain; the page never sees more than its last four characters. Set your limit: above it (default $1) a run asks once.

## What it costs

Every run is billed by fal to you at fal's list price — Gaziyav adds nothing. The price is on the button before you press it.

| Task | Default model | List price (USD) |
|---|---|---|
| Lipsync | LatentSync (ByteDance) | $0.20 per clip up to 40 s, then $0.005/s |
| Voice from text | Qwen3 TTS 1.7B | $0.09 per 1,000 characters |
| Voice clone | Qwen3 voice clone | $0.0008 per minute of sample |
| Picture | Seedream 4.0 | $0.03 per picture |
| Video | Seedance 1.0 Pro Fast | $0.0216/s at 720p |
| Face swap | PixVerse Swap | $0.20 per clip up to 5 s |
| In-app agent, scripts, translation | Gemini 2.5 Flash | by tokens ($0.30 per 1M input) |

Other models for each task, with their prices, are in the model menus and in [AI setup and prices](../ai.md).

## Lipsync, step by step

1. Select the clip with a face → <kbd>⌥L</kbd> (or the clip menu's «Lipsync…», or <kbd>⌘K</kbd> «Lipsync»). Lipsync is one of the tools in the inspector's **AI** tab; each of these opens it.
2. Type what they should say. The voice is cloned from the clip itself.
3. <kbd>⌘</kbd><kbd>↵</kbd>. The price was on the button.

- Only the parts where somebody speaks are sent, and only the face is composited back onto your original frames: a 3-minute clip that is 64 % silence costs **60 ¢ instead of 90.5 ¢**.
- One line of 2–24 s on the default model: **20 ¢**.
- The new words replace the old speech: the clip takes the voice's length, later clips follow the magnet, one <kbd>⌘Z</kbd> undoes it all.
- Several clips at once (three in parallel, the rest queue); a paid run survives quitting the app.
- A 3-second **Sample** first (about 2.6 ¢), played in the panel; the model list shows each model's price for this clip.
- Each result is a **take** of the clip: <kbd>⇧⌥L</kbd> flips original ↔ take; **Another take** makes one more; an amber mark says when the lips no longer match the sound.

[The full lipsync guide →](../lipsync.md)

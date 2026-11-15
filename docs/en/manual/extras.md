# Paid AI on your own key

[← Manual](README.md)

**You don't need any of this to edit.** Gaziyav can run paid AI models through your own [fal.ai](https://fal.ai) key: lipsync, a voice from text, a cloned voice, dubbing, pictures and video from text or a picture, face swap, and the in-app agent (Gaziyav AI) on a paid model.

## Set up

Settings → **AI** → paste your fal.ai key. It is stored encrypted in the macOS Keychain; the editor's interface never gets more than its last four characters. Set your spending limit: a run that costs more (the default limit is $1) asks you once.

## What it costs

fal bills every run to you at fal's list price; Gaziyav adds nothing. The price is on the button before you press it.

| Task | Default model | List price (USD) |
|---|---|---|
| Lipsync | LatentSync (ByteDance) | $0.20 per clip up to 40 s, then $0.005/s |
| Voice from text | Qwen3 TTS 1.7B | $0.09 per 1,000 characters |
| Voice clone | Qwen3 voice clone | $0.0008 per minute of sample |
| Picture | Seedream 4.0 | $0.03 per picture |
| Video | Seedance 1.0 Pro Fast | $0.0216/s at 720p |
| Face swap | PixVerse Swap | $0.20 per clip up to 5 s |
| In-app agent, scripts, translation | Gemini 2.5 Flash | by tokens ($0.30 per 1M input) |

The other models for each task, with their prices, are in the model menus and in [AI setup and prices](../ai.md).

## Lipsync, step by step

1. Select the clip with a face and press <kbd>⌥L</kbd> (or **Lipsync…** in the clip menu, or <kbd>⌘K</kbd> «Lipsync»). Each of these opens the Lipsync tool in the inspector's **AI** tab.
2. Type what the person should say. The voice is cloned from the clip itself.
3. Press <kbd>⌘</kbd><kbd>↵</kbd>.

- Only the parts where someone speaks are sent, and only the face is put back onto your original frames. So a 3-minute clip that is 64 % silence costs **60 ¢ instead of 90.5 ¢**.
- One line of 2–24 s on the default model costs **20 ¢**.
- The new words replace the old speech. The clip takes the length of the new voice, later clips follow the magnet, and one <kbd>⌘Z</kbd> undoes it all.
- You can run several clips at once: three in parallel, the rest wait in a queue. A paid run keeps going if you quit the app.
- Try a 3-second **Sample** first (about 2.6 ¢); it plays in the panel. The model list shows each model's price for this clip.
- Each result is a **take** of the clip. <kbd>⇧⌥L</kbd> switches between the original and the take; **Another take** makes one more. An amber mark shows when the lips no longer match the sound.

[The full lipsync guide →](../lipsync.md)

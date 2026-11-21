# Paid AI: setup and prices

**English** · [Русский](../ru/ai.md)

Gaziyav sells no AI. The editing AI (captions, pause removal, voice clean-up and the rest) runs [free on your Mac](manual/ondevice-ai.md), and [Claude](manual/claude.md) works on your own Claude plan: in the chat inside the editor (through Claude Code) or in the Claude app. This page is about the **optional paid models**. They run on **your own account** with a provider, at **the provider's list price**, and you see the price before you press. Without a key the editor works fully; only the paid buttons wait for one.

## Set up your key (2 minutes)

1. Create an account at [fal.ai](https://fal.ai), add a few dollars of credit, and create an API key in its dashboard.
2. In Gaziyav: **Settings → Services → fal.ai**, paste the key, **Save**.

On macOS the key is stored encrypted on your Mac, in the app's own data folder, with owner-only permissions. It never goes to logs or the environment, and the app shows only its last four characters. With the key in place, Settings also shows fal's **live** price for each model and your balance.

Optional, in the same place: a **kie.ai** key (ByteDance's own lipsync, ElevenLabs voices, more picture and video models) and an **ArgoLink** key (the Seedance 2.0 family). Each model in the pickers says which provider it runs on. If the provider of your pick has no key, Gaziyav falls back to one that has. You can also add free stock-video keys for **Pexels** and **Pixabay** (Wikimedia Commons needs none).

## The spending limit

**Settings → Services → «Confirm spending above [1] $».** Below the limit, pressing a priced button *is* your consent; there is no dialog. Above it, Gaziyav asks once, with the exact total. Spending is added up per provider, by its price list.

## Prices

List prices in US dollars as each API publishes them, read on 6 November 2026.  They change. With a key, Settings shows the live price, and the button always uses it.

### Lipsync

| Model | Maker | Price | Notes |
|---|---|---|---|
| **LatentSync** (default) | ByteDance | $0.20 per run up to 40 s, then $0.005/s | frontal faces, drafts |
| VEED Lipsync | VEED | $0.40/min | cheapest for short pieces |
| Sync 1.9 | Sync Labs | $0.70/min | older generation |
| Sync lipsync‑2 | Sync Labs | $3/min | real footage, head turns, close-ups |
| Sync lipsync‑2 Pro | Sync Labs | $5/min | most detail (teeth, beards), slowest |
| Kling LipSync | Kuaishou | $0.07 per 5 s | 2–10 s pieces only |
| ByteDance Lip Sync *(kie.ai key)* | Volcengine | $0.04/s | up to 240 s; a started job cannot be stopped |

### Voice

| Model | Price | Notes |
|---|---|---|
| **Qwen3 TTS 1.7B** (default) | $0.09 per 1,000 characters | speaks in your cloned voice, 10 languages |
| MiniMax Speech 2.8 Turbo | $0.06 per 1,000 characters | fast, 40 languages |
| MiniMax Speech 2.8 HD | $0.10 per 1,000 characters | MiniMax's highest quality |
| MiniMax Speech‑02 Turbo / HD | $0.06 / $0.10 per 1,000 characters | previous generation |
| ElevenLabs Turbo 2.5 / Multilingual 2 *(kie.ai key)* | $0.03 / $0.06 per 1,000 characters | |
| **Qwen3 voice clone** (default) | $0.0008 per minute of sample | made once per sample |
| MiniMax voice clone | $1.50 per voice | used only with a MiniMax voice |

### Pictures

| Model | Price | Notes |
|---|---|---|
| **Seedream 4.0** (default) | $0.03 | follows the text closely, up to 4K |
| FLUX.1 schnell | $0.003 | drafts and backgrounds |
| Nano Banana | $0.0398 | best at following reference pictures |

### Video (per second of video)

| Model | Price per second | Notes |
|---|---|---|
| **Seedance 1.0 Pro Fast** (default) | $0.0097 (480p) · $0.0216 (720p) · $0.0486 (1080p) | the cheapest here |
| Seedance 1.5 Pro | $0.0117 · $0.0259 · $0.0583 (sound doubles it) | clips with their own sound |
| MiniMax H3 | $0.05 (480P) – $0.16 (4K) | lots of movement |
| Kling 3.0 Standard | $0.084 ($0.126 with sound) | 3–15 s |
| Veo 3.1 Fast | $0.10 (720p / 1080p) · $0.30 (4K) | Google's, with speech and sound |
| Wan 2.6 | $0.10 (720p) · $0.15 (1080p) | several shots in one clip, up to 15 s |
| Seedance 2.0 Fast | $0.1125 (480p) · $0.2419 (720p) | with sound |

Picture-to-video versions of each family are next to them in **Media → Generate → AI video**.

### Face swap

| Task | Model | Price |
|---|---|---|
| Face swap in a clip | PixVerse Swap | $0.20 per clip up to 5 s; longer clips cost double (up to 30 s) |

## What runs where

| Feature | Runs on |
|---|---|
| Editing, playback, effects, titles, export | your computer |
| Captions (speech recognition) | your Mac (Whisper), model downloaded on first use |
| Voice clean-up, separating voice and music, object clean-up | your Mac, models downloaded on first use |
| Lipsync, voice, clone, pictures, video, face swap | your provider (fal.ai, or kie.ai / ArgoLink with their keys, or the service picked in Settings → Services) |
| Gaziyav AI (titles, captions, scripts, the Post sheet's text) and the chat | the Claude you connected, through Claude Code on your Mac |

**Text jobs are not on this list.** In the Mac app, Gaziyav AI — titles, caption styling and translation, scripts, **Create with Gaziyav AI** and **Write with Gaziyav AI** — runs on the Claude you connected in the chat, on your Claude plan, with no text model to choose or pay for ([Claude inside Gaziyav](manual/claude.md)). The browser edition has no Claude chat; its AI tab keeps the text-model choice (Gemini 2.5 Flash by default, on your fal.ai key).

What exactly is sent: [Privacy](privacy.md).

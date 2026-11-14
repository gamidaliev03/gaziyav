# AI setup and prices

**English** · [Русский](../ru/ai.md)

Gaziyav has no AI of its own to sell. The editing AI — captions, pause removal, voice clean-up and the rest — runs [free on your Mac](manual/ondevice-ai.md), and [Claude](manual/claude.md) works through the Claude app you already use. This page is about the **optional paid models**: they run on **your own account** with a provider, at **the provider's list price**, and the price is shown before you press. Without a key the editor works fully; only the paid buttons wait for one.

## Set up your key (2 minutes)

1. Create an account at [fal.ai](https://fal.ai), add a few dollars of credit, and create an API key in its dashboard.
2. In Gaziyav: **Settings → AI → fal.ai**, paste the key, **Save**.

On macOS the key is encrypted with the system Keychain (Electron `safeStorage`) and saved in the app's own data folder with owner-only permissions. It is never written to logs or the environment, and the interface only ever shows its last four characters. With the key in place, Settings also shows fal's **live** price for each model and your balance.

Optional, in the same place: a **kie.ai** key (ByteDance's own lipsync, ElevenLabs voices, more picture and video models) and an **ArgoLink** key (the Seedance 2.0 family). Each model in the pickers says which provider it runs on; a pick whose provider has no key falls back to one that has. Free stock-video keys for **Pexels** and **Pixabay** can be added too (Wikimedia Commons needs none).

## The spending limit

**Settings → AI → «Confirm spending above [1] $».** Below the limit, pressing a priced button *is* your consent — no dialog. Above it, Gaziyav asks once, with the exact total. Spend is added up per provider by its price list.

## Prices

List prices in US dollars as each API publishes them, read on 6 November 2026.  They change: with a key, Settings shows the live price, and the button always uses it.

### Lipsync

| Model | Maker | Price | Notes |
|---|---|---|---|
| **LatentSync** (default) | ByteDance | $0.20 per run up to 40 s, then $0.005/s | good lips for cents |
| VEED Lipsync | VEED | $0.40/min | realistic, cheapest for short pieces |
| Sync 1.9 | Sync Labs | $0.70/min | older generation |
| Sync lipsync‑2 | Sync Labs | $3/min | real footage, head turns, close-ups |
| Sync lipsync‑2 Pro | Sync Labs | $5/min | best detail (teeth, beards), slowest |
| Kling LipSync | Kuaishou | $0.07 per 5 s | 2–10 s pieces only |
| ByteDance Lip Sync *(kie.ai key)* | Volcengine | $0.04/s | up to 240 s; a started job cannot be stopped |

### Voice

| Model | Price | Notes |
|---|---|---|
| **Qwen3 TTS 1.7B** (default) | $0.09 per 1,000 characters | speaks in your cloned voice, 10 languages |
| MiniMax Speech 2.8 Turbo | $0.06 per 1,000 characters | natural, fast, 40 languages |
| MiniMax Speech 2.8 HD | $0.10 per 1,000 characters | the richest MiniMax voice |
| MiniMax Speech‑02 Turbo / HD | $0.06 / $0.10 per 1,000 characters | previous generation |
| ElevenLabs Turbo 2.5 / Multilingual 2 *(kie.ai key)* | $0.03 / $0.06 per 1,000 characters | |
| **Qwen3 voice clone** (default) | $0.0008 per minute of sample | made once per sample |
| MiniMax voice clone | $1.50 per voice | used only with a MiniMax voice |

### Pictures

| Model | Price | Notes |
|---|---|---|
| **Seedream 4.0** (default) | $0.03 | sharp, true to the text, up to 4K |
| FLUX.1 schnell | $0.003 | drafts and backgrounds |
| Nano Banana | $0.0398 | best at following reference pictures |

### Video (per second of video)

| Model | Price per second | Notes |
|---|---|---|
| **Seedance 1.0 Pro Fast** (default) | $0.0097 (480p) · $0.0216 (720p) · $0.0486 (1080p) | the cheapest good clip |
| Seedance 1.5 Pro | $0.0117 · $0.0259 · $0.0583 (sound doubles it) | clips with their own sound |
| MiniMax H3 | $0.05 (480P) – $0.16 (4K) | rich motion |
| Kling 3.0 Standard | $0.084 ($0.126 with sound) | smooth, cinematic, 3–15 s |
| Veo 3.1 Fast | $0.10 (720p / 1080p) · $0.30 (4K) | Google's, with speech and sound |
| Wan 2.6 | $0.10 (720p) · $0.15 (1080p) | multi-shot stories up to 15 s |
| Seedance 2.0 Fast | $0.1125 (480p) · $0.2419 (720p) | with sound |

Picture-to-video versions of each family are offered next to them in **Media → Generate → AI video**.

### Face swap and the agent

| Task | Model | Price |
|---|---|---|
| Face swap in a clip | PixVerse Swap | $0.20 per clip up to 5 s; longer clips cost double (up to 30 s) |
| Agent, AI scripts, the dub's translation | Gemini 2.5 Flash (default) | by tokens, ≈ $0.30 per 1M input tokens |
| | Claude Sonnet 4.5 · GPT-5 mini · DeepSeek V3 | by tokens · or type any OpenRouter model id |

## What runs where

| Feature | Runs on |
|---|---|
| Editing, playback, effects, titles, export | your computer |
| Captions (speech recognition) | your Mac (Whisper), model downloaded on first use |
| Voice clean-up, separating voice and music, voice changer, object clean-up | your Mac, models downloaded on first use |
| Lipsync, voice, clone, pictures, video, face swap, the agent | your provider (fal.ai, or kie.ai / ArgoLink with their keys) |

Exactly what is sent, see [Privacy](privacy.md).

# AI generation, prices and the budget

## Money rules (the order to decide in)
1. Free first where it is as good: the user's media, library music and sounds, motion templates, your own
   `motion_layer` graphics and charts, stock video (`find_content stock`; without a Pexels/Pixabay key only Wikimedia
   answers — then skip stock), web pictures, YouTube pieces. A voice is paid too (cents, by characters). A music clip is video, not
   stills: its shots are paid image→video, and that is the right spend.
2. Paid: the cheapest model that holds the quality. `price_plan {kind, mode}` lists that mode's models with prices
   and typical times; `price_plan {items:[{kind, model?:"cheapest", mode?, duration?, quality?, refs?, count?}]}`
   prices a plan; `price_plan {}` = this video's spend and the balances. `generate {…, model:"cheapest"}` makes it
   with the same model at the same price; the answer names it and what it cost.
3. The user's rule: the balance is the limit. Don't show estimates, don't ask to confirm; build, and report the spend
   per provider at the end. Ask only when the balances can't cover the plan (say how much is missing, once).
4. A provider marked EMPTY (or «balance is empty») → the model the refusal names, or the same kind on the other provider: kie.ai and fal.ai both do
   pictures, image→video, avatars and lipsync. A model id from another mode is mapped to its sibling and the answer
   says so; an unknown id is refused with the list — read it, don't guess ids.
5. A failed generation: read why. A safety refusal names what tripped (the picture or the words): change that one.
   A provider timeout: another model. Never a third identical call. A repeat of a paid call within 30 min returns
   the same result for free (`again:true` for a new take).
`generate {…, quote:true}` prices one call without spending (and without uploading anything).

## What each kind takes (`generate`)
- image `{prompt, refs?: [picture ids], cast?: [name]}` — with refs/cast it follows those pictures (the same person).
- video `{prompt, mode, duration, quality, aspect, seed?, negative?, audio?}` with the mode's inputs:
  text (nothing) · image `from` (the first frame) · frames `from` + `end` · reference `refs`/`cast` (several pictures
  of the subject) · motion `from` (a photo) + `clip` (a person moving) · edit `clip` (+ refs for the style) · avatar
  `from` (a photo) + `sound` (a timeline audio clip: only its trimmed piece is sent and billed; or a Media id with
  `soundFrom`/`soundTo`) · extend `clip` (the scene goes on, kie.ai). A video's answer ends with `next: from:"<media id>@last"`: `from:"<clip or media
  id>@last"` (its last frame as it plays, made when used) starts the next shot, so a scene goes on in one look;
  `seed` repeats a look.
- voice `{text, speaker | cast, start?}` (paid by characters: cents) · lipsync `{id, sound:"timeline", model?}` (one clip a call; `model` = an id of `price_plan {kind:"lipsync"}` or `"cheapest"`; the result keeps the clip's place and length) — the lips follow the sound under the clip
  (a song, a recorded line) · `{id, sound:<Media audio id>}` · `{id, text, speaker}` (a ready voice says it) ·
  `{id, text}` (the person's own voice, cloned from the clip's sound) · revoice `{id, text}` · dub `{id, language,
  lipsync?}` · face_swap `{id, face | photo + consent}` (a real person only with their consent: ask the user).
- Characters across projects: `memory {action:"cast", name, images:[picture ids], description, voice}` once, then
  `cast:["Name"]` in any generate call of any project.

## Camera words in video prompts (per model family; the model id names the family)
| Move | Prompt words | Kling | Seedance | Veo | On real footage (`edit camera`) |
|---|---|---|---|---|---|
| push-in | slow push-in toward the subject | camera slowly pushes in | [push in] | slow dolly in | scale 1.0 → 1.08, eased |
| pull-out | slow pull-out revealing the scene | camera slowly pulls back | [pull out] | slow dolly out | scale 1.1 → 1.0, eased |
| dolly | smooth dolly shot | – | [dolly] | tracking dolly shot | positionX drift 3 %, eased |
| truck | camera trucks sideways with the subject | camera moves left alongside | – | – | positionX drift 5 % |
| orbit | camera orbits around the subject | camera circles around | [orbit] | arc shot around the subject | not on footage: use a generated shot |
| crane | crane shot rising up | – | [crane up] | crane shot ascending | positionY drift up + scale 1.05 |
| crash-zoom | fast crash zoom into the face | – | [zoom in fast] | – | scale 1.0 → 1.35 in 0.25 s |
| whip-pan | whip pan to the side with motion blur | fast whip pan | – | – | whip transition (energetic presets only) |
| handheld | handheld camera, subtle natural shake | – | – | handheld documentary camera | tiny position noise ±4 px |
| static | locked-off static camera, tripod | – | – | – | no move |
| dolly-zoom | dolly zoom, vertigo effect | – | – | – | not on footage |
| fpv | FPV drone flying fast through the scene | – | – | – | not on footage |
| ken-burns | slow pan and zoom over a still | – | – | – | scale 1.0 → 1.1 + drift, eased |
| tilt | camera tilts up slowly | – | [tilt up] | – | positionY drift |
| over-shoulder | over-the-shoulder shot | – | – | – | framing only |

Runway: «camera slowly dollies forward» (push-in) · PixVerse: «orbit shot» · other families: the prompt words.

## Models and their inputs (11.2026 snapshot; `price_plan {kind:"video"|"image"|"lipsync"|"voice"}` lists today's)
| Video family | API | modes | seconds | resolution | refs | extras | $/s at start |
|---|---|---|---|---|---|---|---|
| Grok Imagine | kie | text image | 6–30 | 480p/720p/1080p | - | - | $0.012 |
| Hailuo 2.3 Pro | kie | image | 6–10 | 768P/1080P | - | - | $0.0375 |
| Hailuo 2.3 | kie | image | 6–10 | 768P/1080P | - | - | $0.025 |
| HappyHorse 1.1 | kie | text image reference | 3–15 | 720p/1080p | 9 | - | $0.1125 |
| InfiniteTalk | kie | avatar | - | 480p/720p | - | - | $0.015 |
| Kling 2.6 Motion Pro | fal | motion | - | - | - | - | $0.112 |
| Kling 2.6 Motion Standard | fal | motion | - | - | - | - | $0.07 |
| Kling 2.6 Motion | kie | motion | - | 720p/1080p | - | - | $0.063 |
| Kling 2.6 Pro | fal | image frames | 5–10 | - | - | sound,neg | $0.07 |
| Kling 3.0 Motion Pro | fal | motion | - | - | - | - | $0.168 |
| Kling 3.0 Motion Standard | fal | motion | - | - | - | - | $0.126 |
| Kling 3.0 Motion | kie | motion | - | 720p/1080p | - | - | $0.1135 |
| Kling 3.0 Omni | kie | edit | - | 720p/1080p/4k | - | - | $0.1135 |
| Kling 3.0 Omni | kie | text image frames reference | 3–15 | 720p/1080p/4k | 7 | sound | $0.0755 |
| Kling 3.0 Pro | fal | image | 3–15 | - | - | sound,neg | $0.112 |
| Kling 3.0 Standard | fal | text image frames | 3–15 | - | - | sound,neg | $0.084 |
| Kling 3.0 Turbo | kie | text image | 3–15 | 720p/1080p | - | - | $0.101 |
| Kling 3.0 | kie | text image frames | 3–15 | 720p/1080p/4K | - | sound | $0.0755 |
| Kling 4.0 Flash | kie | image reference | 3–20 | 720p | 10 | - | $0.085 |
| Kling 4.0 | kie | frames reference | 3–30 | 720p/1080p | 10 | - | $0.1425 |
| Kling AI Avatar 2 Pro | fal | avatar | - | - | - | - | $0.115 |
| Kling AI Avatar 2 | fal | avatar | - | - | - | - | $0.0562 |
| Kling AI Avatar Pro | kie | avatar | - | - | - | - | $0.101 |
| Kling AI Avatar | kie | avatar | - | - | - | - | $0.0505 |
| Kling O3 Edit | fal | edit | - | - | - | - | $0.126 |
| Kling O3 Standard | fal | reference | 3–15 | - | 4 | sound | $0.084 |
| Lucy Restyle | fal | edit | - | - | - | seed | $0.01 |
| MiniMax H3 | fal | text image frames reference | 5–15 | 768P/480P/2K/4K | 9 | seed | $0.06 |
| OmniHuman 1.5 | fal | avatar | - | 720p/1080p | - | - | $0.16 |
| OmniHuman 1.5 | kie | avatar | - | 720p/1080p | - | - | $0.135 |
| OmniHuman 2 | fal | avatar | - | - | - | - | $0.105 |
| OmniHuman 2.0 | kie | avatar | - | - | - | - | $0.07 |
| PixVerse V6 | kie | text image frames extend | 1–15 | 720p/360p/540p/1080p | - | sound,seed | $0.036 |
| Seedance 1.0 Lite | kie | text image frames | 5–10 | 720p/480p/1080p | - | seed | $0.0225 |
| Seedance 1.0 Pro Fast | fal | text image | 2–12 | 720p/480p/1080p | - | seed | $0.0216 |
| Seedance 1.0 Pro | kie | text image | 5–10 | 720p/480p/1080p | - | seed | $0.03 |
| Seedance 1.5 Pro | fal | text image frames | 4–12 | 720p/480p/1080p | - | sound,seed | $0.0259 |
| Seedance 2.0 Fast | argo | text image frames reference | 4–15 | 720p/480p | 9 | sound | $0.103 |
| Seedance 2.0 Fast | fal | text image frames | 4–15 | 720p/480p | - | sound | $0.2419 |
| Seedance 2.0 Fast | kie | text image frames reference | 4–15 | 720p/480p | 9 | sound | $0.124 |
| Seedance 2.0 Mini | argo | text image frames reference | 4–15 | 720p/480p | 9 | sound | $0.0643 |
| Seedance 2.0 Mini | fal | reference | 4–15 | 720p/480p | 9 | sound | $0.1512 |
| Seedance 2.0 Mini | kie | text image frames reference | 4–15 | 720p/480p | 9 | sound | $0.041 |
| Seedance 2.0 | argo | text image frames reference | 4–15 | 720p/480p/1080p/4k | 9 | sound | $0.129 |
| Seedance 2.0 | kie | text image frames | 4–15 | 720p/480p/1080p/4k | - | sound | $0.205 |
| Seedance 2.5 | kie | text reference | 5–30 | 720p/480p/1080p | 30 | sound | $0.315 |
| VEED Fabric 1.0 | fal | avatar | - | 480p/720p | - | - | $0.08 |
| Veo 3.1 Fast | fal | text image frames | 4–8 | 720p/1080p/4k | - | sound,seed,neg | $0.10 |
| Veo 3.1 Fast | kie | text image frames | 4–8 | 720p/1080p/4k | - | - | $0.075 |
| Veo 3.1 Lite | kie | reference | 8–8 | 720p/1080p/4k | 3 | - | $0.0187 |
| Vidu Q4 | fal | reference | 3–16 | 540p/720p/1080p/2K/4K | 12 | sound,seed | $0.0315 |
| Vidu Q4 | kie | image reference | 3–16 | 720p/540p/1080p/2k/4k | 15 | sound | $0.076 |
| Wan 2.6 | fal | text image | 5–15 | 720p/1080p | - | seed,neg | $0.10 |
| Wan 2.6 | kie | text image | 5–15 | 720p/1080p | - | - | $0.07 |
| Wan 2.7 Edit | fal | edit | - | 720p/1080p | - | seed | $0.10 |
| Wan 2.7 Edit | kie | edit | - | 720p/1080p | - | seed | $0.08 |
| Wan 2.7 | kie | text image frames reference | 2–15 | 720p/1080p | 5 | seed,neg | $0.08 |
| Wan 3.0 | kie | text image | 5–30 | 720P/480P/1080P | - | sound,seed | $0.08 |

| Picture model | API | $/picture |
|---|---|---|
| Seedream 4.0 | fal | $0.03 |
| FLUX.1 schnell | fal | $0.003 |
| Nano Banana | fal | $0.0398 |
| Seedream 4.0 | kie | $0.025 |
| Seedream 4.5 | kie | $0.0325 |
| Seedream 5.0 Pro | kie | $0.035 |
| Nano Banana | kie | $0.02 |
| Nano Banana 2 | kie | $0.04 |
| Nano Banana Pro | kie | $0.09 |
| GPT Image 2 | kie | $0.03 |
| Grok Imagine | kie | $0.02 |
| Qwen Image 2.1 | kie | $0.02 |
| FLUX.2 Pro | kie | $0.025 |

| Voice / lipsync / swap | task | API | price |
|---|---|---|---|
| LatentSync | lipsync | fal | $0.20/clip |
| VEED Lipsync | lipsync | fal | $0.0067/second |
| Sync 1.9 | lipsync | fal | $0.0117/second |
| Sync lipsync-2 | lipsync | fal | $0.05/second |
| Sync lipsync-2 Pro | lipsync | fal | $0.0833/second |
| Kling LipSync | lipsync | fal | $0.07/5s |
| Qwen3 TTS 1.7B | tts | fal | $0.09/1k-chars |
| MiniMax Speech 2.8 Turbo | tts | fal | $0.06/1k-chars |
| MiniMax Speech 2.8 HD | tts | fal | $0.10/1k-chars |
| MiniMax Speech-02 Turbo | tts | fal | $0.06/1k-chars |
| MiniMax Speech-02 HD | tts | fal | $0.10/1k-chars |
| PixVerse Swap | faceswap | fal | $0.20/5s |
| ByteDance Lip Sync | lipsync | kie | $0.04/second |
| ElevenLabs Turbo 2.5 | tts | kie | $0.03/1k-chars |
| ElevenLabs Multilingual 2 | tts | kie | $0.06/1k-chars |

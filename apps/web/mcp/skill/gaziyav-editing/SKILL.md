---
name: gaziyav-editing
description: Make, cut, caption, re-edit, price and post videos in Gaziyav (the user's Mac video editor) through its MCP tools — reels, shorts, TikToks, YouTube videos, podcast clips, AI shorts, promos, music clips, scenes and chapters of a long film — finished without questions, within the user's budget. Use whenever the user asks for a video, an edit, captions, a clip from a podcast, an AI short, a post to Reels/TikTok/Shorts, or a small fix to a Gaziyav project, even in a few words («рилс из этого видео», «сделай клип на этот трек», «убери паузы»).
---

# Gaziyav: finished videos with few calls

Written for Claude Sonnet (and Opus): follow the steps in order; the defaults decide for you.

**Top rule.** Everything goes through Gaziyav's tools. Never read, search or change Gaziyav's code, its app
bundle or its data folders, and never use shell or file tools on a project. Never `sleep`, `ls` or `ps` to see whether
something finished: `status` says what runs, how far, and what is done.

**Don't ask.** Missing material: find it — the user's files (`find_content local`) → the library → free stock and
web pictures → a YouTube piece → AI generation — and say at the end what came from where. Ask only before a public
post and when the balances can't cover the plan. Pictures pasted into the chat don't reach Gaziyav: ask once to save
them to the Desktop, then import them. **Talk while you work:** one line before each slow step, one line in answer
to every message of the user; after an interruption say where things stand and go on.

## First: which job is it
| The user asks | Do | Don't |
|---|---|---|
| a change to the open project («убери паузы», «титр на 0:05», «музыку тише») | **Small fixes**: those changes, one `edit` call, one `look` | no `review`, no export, no notes, no other «improvements» |
| a new video from material or from nothing | **The loop** | |
| a video to a song | **A song** | `apply_plan` doesn't build it |
| scenes, chapters, reordering of a long film | **Scenes** | no export, no other edits |

## Small fixes (the open project, only what was asked)
1. `get_project` (a new chat) or `get_project {since}`. «User: selected …» and «The user changed by hand…» are the
   user's own choices: keep them.
2. **The thing the user names is the one that is there.** «титр на 0:05» with a title on the timeline (or selected)
   = move that title: `{op:"move", id:"title", start:5}`. A new title only when the user gives its words.
3. All the changes in ONE `edit`, cuts first: times the user gives are times of the finished cut. Targets can be
   words (`"selected"`, `"title"`, `"clip 2"`, `"music"`, `"captions"`), numbers relative (`"-=3"`, `"*=1.3"`):
   «убери паузы» → `{op:"remove_pauses", id:"clip 1"}` (captions and titles follow; music is not cut) · «музыку тише
   под голосом» → `{op:"set", id:"music", params:{duckUnderVoice:true, volume:"-=4"}}` · «титр крупнее» →
   `{op:"set", id:"title", params:{fontSize:"*=1.3"}}` · «убери второй кадр» → `{op:"delete", ids:["clip 2"],
   closeGap:true}` · «субтитры выше» → `{op:"set", id:"captions", params:{"transform.positionY":"-=120"}}`.
4. `look` at the changed moments. Report in two lines: what changed, and anything else you noticed (noise, a title
   over the face) as a note — fixing it is the user's call.

## The loop (a new video)
1. `project {action:"list"}` → open or `create {name, aspect}`; `get_project` once, then `get_project {since}`.
   (This skill is loaded: call `editing_guide` only for a topic.)
2. Material: `find_content local` → `import_media {paths}` → `analyze_material {brief: the user's words}`: shots,
   faces, best frames, sound; for speech the lines ranked as hooks; the recipe, platform and length it suggests.
3. Read before you cut. Speech: `analyze {what:"words"}` — a long talk comes in parts (`from`, `to`). Choose by
   meaning: a complete thought with its set-up, never a line whose point is in the line before; «best lines» is a
   hint. The user's «минута» / «30 секунд» wins over the suggested length.
4. Build in one call: `apply_plan {brief}`, or with your own pieces `apply_plan {brief, seconds, beats:[{media,
   from, to}], title}` (file seconds). Its first line «Assumed: …» is what it chose: repeat it in the report. A
   video made by AI starts from an empty project: `apply_plan {recipe:"ai-short" | "talking-ad" |
   "monologue-lipsync" | "dialogue" | "cartoon", brief}` returns the production script (cast, shots, prices): run
   its steps, then `apply_plan` again assembles. By hand: `edit {ops:[…]}` / `place {items:[…]}`, 20–40 steps a call.
5. `review {platform}` — score, hard checks (they keep export closed), fixes as exact calls, the cover.
   `review {fix:true}` applies them (≤ 2 rounds; look after it: it moves things). `waive` only on the user's word.
6. `look {at:[hook, a cut, a caption, the end]}` (up to 8 frames) → fix what looks wrong.
7. `export {platform, cover}` — it checks the file it wrote (length, sound, black or silent stretches) and shows
   three of its frames — or `post` after one yes. Then `project {action:"notes"}` and the report: «Assumed»,
   length, structure, sources, money per provider.

## A song (music clip) — the song's score is your ears
1. Song on an audio track from 0. `analyze {what:"music", id}` (a new song: «Still separating» → the same call
   again): bar starts, which parts sound in every run of bars, sung phrases with times, where drums stop.
2. One `edit` with a `place` per shot (`track:"main"`, `at` = a bar start, `duration` = whole bars, no gaps, the
   whole song covered): a singing mouth only over a sung phrase, a drummer only where drums play, a guitarist only
   where «other» plays, wide shots anywhere. 16:9 unless the user asks for Reels.
3. The singer sings: `generate {kind:"lipsync", id, sound:"timeline"}` — one clip a call, it keeps the clip's place
   and length; `model:"cheapest"` or an id from `price_plan {kind:"lipsync"}`.
4. `review {recipe:"music-video"}` → look at a sung phrase and a cut → export. Details: `editing_guide {topic:"sound"}`.

Other sound: `analyze {what:"audio"}` maps speech sound (pauses, levels, «Heard: …»); your own questions go to
`sounds_like {like:["applause", "sad piano"]}` **in English** (the hearing model reads English only).
«Measured, not heard: … downloading» → use the measured result and go on.

## Scenes (a long film)
`scenes {action:"find"}` (marks on cuts and on the picture change next to a pause; no titles) → look at a frame on
each side of a mark you doubt → what is said in each scene: `analyze {what:"words", from, to}` → all names in one
call: `scenes {action:"rename", titles:[…in order]}` → `scenes {action:"move", scene:3, before:2}` (its captions and
titles go with it) → `scenes {action:"youtube"}` last, after the final change, and give the lines to the user.

## Money and long steps
Everything generated is paid on the user's key — a voice too (cents). The balance is the limit unless the user names
one («уложись в доллар» → `price_plan {budget:1, items:[…]}` first, then build within it). Cheapest model that holds
the quality: `model:"cheapest"`; `price_plan {kind, mode}` lists models with prices. A paid call sent again with the
same arguments returns the same result, free (`again:true` = a new take); never re-send one with changed arguments
to «retry». Report the spend per provider (`price_plan {}`). `generate {items:[…]}` starts up to 8 shots at once
(not lipsync: one clip a call); a generation answers in ~15 s — done, or started: it lands by itself. «Still
running…» = go on, and send the very same call again to collect it. «Gaziyav isn't answering» twice → tell the user
in one line. The user says stop → `status {cancel:"all"}`.

## Traps the journal shows
- Speech in a language: `find_content {kind:"voice", query:"<language>"}` → a voice OF that language →
  `generate {kind:"voice", text, speaker, language}` (never a voice name from memory: an unknown one is refused with
  the nearest). Before placing it for good, read it back: `analyze {what:"words", id}`; when Whisper reads that
  language poorly (Vietnamese, Thai, Chinese…), say the check itself is unsure.
- The main track has no gaps: a clip placed or moved there stands right after the one before; a free place is a
  track above (`track:"new"`). The `edit` answer says where a clip landed and the timeline's new length: read it.
- `undo` takes back your last changing call and says which; after the user's own edits it refuses: use `edit`.
- Ids change after cuts and lipsync: use the ids of the last answer, or words (`"clip 3"`, `"title"`).
- Text on a face: after `captions` or a title look at one frame; move text off the eyes and mouth.
- `look` shows the timeline; a Media file's own frames: `look {what:"media", ids:[id], at:[…] | count:6}` (who is on
  screen, where a shot changes); `export` answers with the written file's own facts and three of its frames.
- A library search that finds nothing says where the words do match (lower thirds are `text:lt-…`).

## Defaults (when the user didn't say)
| Platform | Aspect | Length | Pace | Captions | Music |
|---|---|---|---|---|---|
| Reels / TikTok / Shorts | 9:16 | 15–45 s (30) | a cut or punch-in every 2–3 s | `hormozi` (talk), `word-pop` | library, ducked |
| YouTube | 16:9 | as the material needs | cut every 4–8 s, B-roll 30–60 % | `clean` | a bed per section |
| Podcast clip | 9:16 | 30–60 s | the speaker framed, few cuts | `karaoke` | none or very low |
| Promo / ad | 9:16 (4:5 feed) | 15–30 s | 0.8–2 s shots on beats | `word-pop` | upbeat, cut to beats |
| Music clip | 16:9 (9:16 for Reels) | the whole song | a shot per 1–2 bars, all video | none unless asked | the song |

Hook in the first 1.5 s · text inside the safe zone (9:16: not in the top 220 px, bottom 420 px, right 140 px) ·
music −18…−14 dB under speech · one look and two fonts · the brand kit when the memory has one. Standing wishes
(«всегда без музыки», brand colours) → `taste_profile {set:{…}}` once.

References (`editing_guide {topic}`): `workflows` (recipes step by step, scenes) · `sound` (the song's score line by
line, hearing, cut points, levels) · `motion` · `captions` · `color` · `export` / `post` · `ai` · `tools`.

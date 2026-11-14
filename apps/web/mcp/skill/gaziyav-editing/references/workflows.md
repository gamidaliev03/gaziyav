# Workflows (step by step)

Every workflow ends the same: `review` → fix → `look` → `export` or `post` (one yes) → `project {action:"notes"}` →
report (the «Assumed» line, length, sources, spend per provider). Times are timeline seconds; ids come from answers.

## Brief words → recipe (apply_plan and analyze_material read a brief the same way)
| Brief words | Recipe | Preset | Length | Platform |
|---|---|---|---|---|
| рилс из этого / reel from this | reel-talking-head | profile (clean-premium) | 30 s | reels |
| тикток / tiktok, шортс / shorts | reel-talking-head | profile | 30 s | tiktok / shorts |
| ютуб на 8 минут про X / 8-min YouTube about X | youtube-video | profile | 8 min | youtube |
| нарезка из подкаста / podcast clips | podcast-clips | podcast | 40 s | reels |
| промо для товара / promo for a product | promo | profile (luxury if «дорого») | 20 s | reels |
| ИИ-ролик по сценарию / AI short from a script | ai-short | energetic-reel | 30 s | profile (reels) |
| клип на песню / music video | music-video | energetic-reel | 60 s | reels |
| говорящее фото, монолог / talking photo, avatar | monologue-lipsync | profile | 30 s | reels |
| диалог двух героев / dialogue scene | dialogue | documentary | 40 s | reels |
| мультик / cartoon | cartoon | energetic-reel | 45 s | shorts |
| объясняющее видео, инфографика / explainer | explainer | tech-review | 2 min | youtube |
| документалка с нарезкой с ютуба / documentary | documentary | documentary | 5 min | youtube |
| слайдшоу из фото / photo story | photo-story | documentary | 30 s | reels |
| трейлер / trailer | trailer | documentary | 60 s | youtube |
| туториал с записи экрана / screen tutorial | screen-tutorial | tech-review | 5 min | youtube |
| UGC-реклама с аватаром / talking ad | talking-ad | profile | 30 s | reels |
| + дорого·люкс / luxury · кино·документ / documentary · обзор·техно / tech · динамично / energetic | — | that preset | — | — |
| + N сек / N s · N мин / N min | — | — | N | — |

What the words don't say comes from the taste profile (`taste_profile`). `apply_plan {brief}` alone works.

## The 15 recipes (`apply_plan {recipe}`)
- `reel-talking-head` — one person speaking → 15–45 s vertical: best line first, punch-ins and B-roll every 2–3 s, word captions, loop end (free)
- `youtube-video` — talk, tutorial, review → 16:9: cold open ≤ 15 s, title ≤ 3 s, chapters, B-roll 30–60 %, music per section, end screen (free first)
- `podcast-clips` — a long conversation → the best quotes as vertical clips, speaker framed, two-line captions (free)
- `ai-short` — a script → voice, a picture or clip per line (generated where it lifts the video most), captions, music (generated, priced first)
- `promo` — a product → problem, product, proof, offer, CTA in 15–30 s; product shots with motion, the offer as text (free first)
- `talking-ad` — script → voice → an avatar from a photo (or lipsync on real footage) → captions, product shots, CTA; ≈ $2–3 of generation per 30 s (generated, priced first)
- `music-video` — a song → cuts on the beat, lyrics as captions, performance shots (lipsync to the song), AI shots with the cast (free first)
- `monologue-lipsync` — a photo or a cast member speaks a text: cloned or ready voice, lipsync, captions (generated, priced first)
- `dialogue` — two characters: shot / reverse shot, a voice each, lipsync per shot, the 180° rule kept (generated, priced first)
- `cartoon` — one illustrated style for characters and backgrounds: pictures → animated (image to video), motion, voices, music (generated, priced first)
- `explainer` — facts and numbers → animated charts, counters, kinetic text over a voice-over (free)
- `documentary` — a voice over archive: YouTube excerpts (only the needed seconds), lower thirds naming the source, slow pace (free first)
- `photo-story` — photos → a story on the beat: slow push-ins, one dissolve style, titles, music (free)
- `trailer` — the strongest moments, fast, risers and hits at the turns, big titles, music that builds (free)
- `screen-tutorial` — a screen recording + voice → zoom-ins on what is clicked, cursor emphasis, chapters per step (free)

## 1. Talking head → reel (default 30 s, 9:16)
1. `project {action:"create", name, aspect:"9:16"}`; `find_content {kind:"local", query}`; `import_media {paths}`.
2. `analyze_material {brief: the user's words}` → best quotes, retakes, filler %. (Or `analyze {what:"words"}`.)
3. `apply_plan {recipe:"reel-talking-head", platform:"reels", seconds:30, beats:[{quote:1},{quote:3},…], title, cta}`
   builds it in one call (cuts on cut points, punch-ins, captions, music, SFX) and returns the review score.
   Without apply_plan: `edit {ops:[{op:"place", media, track:"main", at:0, sourceFrom, duration}…, {op:"cut_out",
   ranges}, {op:"captions", style:"hormozi"}, {op:"place", item:"music:…", at:0}, {op:"place", item:"text:<hook style>",
   text, at:0, duration:2}]}`.
4. Punch-ins hide jump cuts: `{op:"camera", id:"clip 2", move:"punch_in", amount:0.12}` on every other clip.
5. `review {platform:"reels"}` → fix → `look {at:[0.5, a cut, a caption, end-1]}`.

## 2. Podcast → clips (3 × 30–60 s)
1. Import the episode; `analyze_material` → ranked quotes (hook potential, complete sentences).
2. For each quote: `project {action:"create", name:"<topic> clip N", aspect:"9:16"}` → `place {media, track:"main",
   sourceFrom: quote.from − 0.3, duration}` → `edit {ops:[{op:"make_vertical"}, {op:"captions", style:"karaoke"}]}`
   → a hook title from the quote's first words.
3. No music or very low (−24 dB). Review each, then post each after one yes for the batch.

## 3. AI short from a script (and talking-ad, monologue-lipsync, dialogue, cartoon: the same flow)
1. `apply_plan {brief: the user's words}` before any material returns the production script: the cast sheets
   once, a picture per shot with the cast's references, each animated from its picture (480p drafts), the next shot
   of a scene started from the last frame of the one before, the voices, lipsync where a face speaks, the assembly.
2. Its first step is `price_plan`: show the total in one line → go on (within the budget, no more questions).
3. Run the steps in order. Put the ids the answers give in place of `SHEET_x`, `PIC_n`, `CLIP_n`; `LAST_n` is
   `from:"<CLIP_n id>@last"` (that clip's last frame as it plays, made when used). `model:"cheapest"`
   where the quality allows; camera words per model family are in `ai`.
4. The chosen drafts again at 1080p with the draft's `seed`; then `apply_plan {recipe:"ai-short"}` assembles (cuts on
   the voice, captions, music, sounds, one grade) → review.
Without a script: per beat free (stock, web picture, motion layer) or paid — `generate {kind:"image", prompt,
cast:[name]?, place:false}`, then `generate {kind:"video", mode:"image", from:<picture>, duration:5}`; the next shot
`from:"<clip id>@last"`; a still only for a brief beat (`camera ken_burns`); a face that speaks `generate {kind:"lipsync", id, text}` (its words in a ready voice: `speaker`; a recorded line: `sound`).

## 4. Promo / ad (15–30 s): problem → product → proof → offer → CTA
1. Music first: `place {item:"music:…", at:0}`; `analyze {what:"beats", id:"music"}`.
2. Shots 0.8–2 s on the beats (`place {items:[…]}` with `sourceFrom` = the best moment of each clip).
3. Text per beat (`place {item:"text:…", text}` or `motion_layer` for a price card / counter); the offer as a number.
4. Two transitions at most (`place {item:"transition:…", at: cut}`) + a whoosh 0.1 s before each.
5. CTA in the last 2–3 s (`find_content {kind:"motion", query:"call to action"}`); one look on all clips
   (`place {item:"filter:…", on:"all"}`).

## 5. Music clip («клип на этот трек») — every second moves, the singer sings, the picture follows the sound
`apply_plan` does not build a music video (it answers with this method): the cut is made by hand from the score.
**From the user's own footage** (shots of the singer, the band, the stage): the song on an audio track from 0 →
`analyze {what:"music"}` → ONE `edit` with a `place` per shot on bar starts (`track:"main"`, `duration` = whole
bars, no gaps, the whole song; the frame stays 16:9 unless the user asks for Reels) → lipsync each singer shot to the
song under it, one clip a call → `review {recipe:"music-video"}`. A raw shot of a singing mouth goes only over a sung
phrase; a drummer only where drums play; a guitarist only where «other» plays. **From nothing** — the steps below.
1. Listen first: `analyze {what:"music", id}` on the full song — sections (intro, verse, chorus, bridge, outro),
   which instruments play when, the sung lines with times, genre and mood, all heard on the full mix (never judge
   the genre from a stem). The shot list follows that map: the drums hit → cut on the hits and show the drummer;
   guitar only → the guitarist; a sung line → the singer singing that very line; quiet → slower, wider shots.
2. The cast once: each musician with their instrument and outfit (`memory {action:"cast", name, images,
   description}`), from the user's photos when there are any — the same faces and instruments in every shot.
3. Shots: about one per 2–3 s of song (a 2:30 song ≈ 50–70), EVERY shot is video: a picture → `generate
   {kind:"video", mode:"image", from, duration:4–5}` (`generate {items:[…]}` starts up to 8 at once). Use a good
   frame or clip twice at most, with another part of it. A still only as a ≤ 0.5 s flash on a hit; never more than
   10 % of the length, never an «animatic» of stills on the main track.
4. The singer sings on screen in every verse and chorus. Lipsync to the song: place the singer's video over its
   line, then `generate {kind:"lipsync", id:<that clip>, sound:"timeline"}` (the song under it drives the lips; one
   clip a call — it keeps the clip's place and length; `model:"cheapest"` or an id of `price_plan {kind:"lipsync"}`); or
   an avatar `generate {kind:"video", mode:"avatar", from:<picture>, sound:<the vocal clip on the timeline>}` — only
   its trimmed piece is sent and billed. A lipsync clip sits exactly at its own sound's time; mute the AI clips'
   own audio.
5. Before making 30 pictures to animate: ONE test video and ONE lipsync from one picture. If either fails, fix that
   path first (`price_plan {}` shows an EMPTY provider: use the other provider's models) — never fill the cut with
   stills instead, never call a slideshow done. If animation is really blocked, say so in the first line with what
   fixes it (a top-up), before building anything.
6. While the shots generate, build the rest: the artist and track title at the start, transitions on the accents
   (`find_content transition`), a flash or shake on drum hits, SFX on hits and whooshes before cuts, one look and
   grain on all clips (`place {item:"filter:…", on:"all"}`). Cuts on downbeats, longer shots in quiet parts.
7. `review {recipe:"music-video"}` — hard checks: stills ≤ 10 %, no clip used more than twice, every lipsync at
   its sound, singing in every chorus. Fix, then `look` at a chorus, a hit and the end.
8. No captions unless asked; the song's own volume as it is.

## 6. YouTube video (16:9)
Cold open ≤ 15 s (the best moment) → title card ≤ 3 s → chapters from the topics → B-roll 30–60 % (stock, the
user's clips) → lower thirds for names → stats as `motion_layer` charts → end screen 5–20 s. Captions `clean`.
Export `{platform:"youtube"}`; Share → Post takes short vertical videos only, so a long video is a file for the user.

## 7. Small fixes in an open project
`get_project {since}` (or nothing: the answer of your next call lists the user's changes) → one `edit` with all the
changes (targets by words) → `look` at the changed moment. No re-analysis, no `review`, no export, no notes: the user
asked for these changes and nothing else. What the user names is what is there: «титр на 0:05» with a title on the
timeline moves that title (a new one only when the user gives its words); times are those of the finished cut.
What else you notice (noise, text over a face, a hard check of an old review) is one line in your answer.

## 8. Scenes and chapters of a long film
`scenes {action:"find"}` → the list with each scene's start in seconds and the first words said in it. A mark found
by a pause sits on the picture change next to it when there is one: check a doubtful mark with `look {at:[mark −
0.2, mark + 0.2]}` and fix it with `scenes {action:"split", at}` + `merge`. Names: read each scene
(`analyze {what:"words", from, to}`), then `scenes {action:"rename", titles:[…]}` in one call. Reorder with
`scenes {action:"move", scene, before | after | to}` (captions, titles and sounds inside go with it; music beds
stay; the length is kept). `scenes {action:"youtube"}` comes last, after the final change: give its lines to the
user (YouTube needs ≥ 3 chapters, the first at 00:00, each ≥ 10 s). No export unless asked.

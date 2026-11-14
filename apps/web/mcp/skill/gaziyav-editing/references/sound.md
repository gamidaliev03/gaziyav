# Sound (half of the edit)

## Listen before cutting
1. `analyze {what:"audio"}` — the audio map as text: words #n with times, pauses (silence / room / breath / music),
   loudness, clipping, clicks, beats and sections, ranked cut points. `picture:true` adds one small waveform +
   spectrogram picture with the words and cuts marked: use it only at a cut you doubt.
2. `analyze {what:"words"}` — phrases with times: retakes (a line said again later: keep the last complete one),
   false starts, filler.

## A song: ask its score first — it is your ears for music
You cannot hear the song. Gaziyav separates it on this Mac into four parts (vocals, drums, bass, other = guitars,
keys, synths) and measures each one; that measurement — the score — is the only truth about what sounds when. Plan
every shot of a music video from it, never from the song's title, the genre or a guess.

**Ask first, once:** `analyze {what:"music", id:<the song's clip>}` (no id: the longest sound on the timeline).
- A new song may answer «Still separating … (40 %)»: send the very same call again about a minute later. It is never
  run twice and never charged; every later call answers at once from the cache.
- Never compute tempo, beats, levels or lyrics in a shell, and never ask the user where the vocals are: it is all here.

**What each line means** (all times are timeline seconds, ready for `place {at}`, `split {time}`, `trim`):
- `Tempo (on the drum stem): 120 BPM 2.49–25.99 · 140 BPM 25.99–46.33` — the tempo per stretch; a change of tempo is
  a change of pace for the cutting too. `sure 6 %` on bar 1: the bar lines may be off by a beat or two — cut on beats
  (any beat is safe) rather than insisting on «the one».
- `Bar starts: 1@2.00 2@4.00 …` — every bar line. Cuts on these feel right; strong moments (a new shot of the
  singer, a title) on the first bar of a section.
- `Sections: bars 5–12 9.99–25.99 part B: drums, bass` — the song's parts by what plays and how loud. The same letter
  means the same music comes back (part A again = the same kind of shots again). Names (verse, chorus, intro,
  outro, bridge, instrumental) appear only when the song's shape supports them; otherwise «part A / part B».
- `What sounds, by bars:` — one line per run of bars: which parts play, and the sung phrases inside it with their
  start–end. `no vocals` = nobody sings there. `no band` = no instrument.
- `Vocals (phrases on the voice stem …)` — every sung phrase: start–end, the bar it starts in, and its words as
  heard on the voice alone. A phrase's start is when the mouth opens, its end when it closes.
- `No voice (≥ 2 s)` — where the singer is silent: no lip-sync shots there.
- `Drums play … · stop at 46.33` and `Breaks (drums out …)` — where the drummer may be shown hitting, and where not.
- `Bass plays` / `Other (guitars, keys) plays` — where the bassist / guitarist may be shown playing.
- `Strongest hits` — the hardest kicks, snares and cymbals: flashes, impacts, hard cuts, a title slam.
- `Genre (AudioSet tagger …)` — style and mood only (for the look and the pace), never for placing shots.

**Detail on a stretch:** `analyze {what:"music", from, to}` over ≤ 40 s gives every bar with the parts and their
levels, each kick, snare, cymbal and guitar attack with its time, and every word with its time (`word@29.57`). Ask
it for the stretch you are cutting right now — the chorus, the drop, a fill — instead of guessing between bars.

**The parts as tracks:** `edit {ops:[{op:"split_parts", id}]}` lays «· vocals», «· drums», «· bass», «· other»
under the song, in sync and muted (one ⌘Z removes them); `{op:"split_parts", solo:"drums"}` hears one part alone,
`solo:"mix"` the song again. `analyze {what:"cut_points", id:<a part or a muted clip or a Media id>, at}` works on all
of them; on a picture clip with no sound it cuts on the song under it.

### Worked example 1 — a punk band clip, 4 shot kinds
The answer says: `bars 1–4 (2.00–9.99): drums, other · vocals 6.04–7.49`, `bars 5–12 (9.99–25.99): drums, bass ·
vocals 15.00–16.29`, `Drums play 2.00–46.33 · stop at 46.33`, phrases `6.04–7.49 “hello world this is a test”`,
`15.00–16.29 “the drums are playing now”`, strongest hits `…`, bar starts `1@2.00 2@4.00 3@6.00 4@8.00 5@9.99 …`.
The plan:
- 2.00–6.00 guitarist (other plays, nobody sings yet).
- 6.00–8.00 singer: the bar line just before the mouth opens (6.04) to the next bar line, past the phrase's end (7.49).
- 8.00–9.99 guitarist again; at 9.99 the bass comes in: cut to the bassist exactly there.
- 9.99–14.00 drummer, then bassist (a cut every 2 bars: 9.99, 11.99); 14.00–16.50 singer (phrase 15.00–16.29);
  16.50 back to the drummer — no singer again until the next phrase.
- 46.33 the drums stop: the last drummer shot ends at 46.33; after it only the guitarist (other plays to 52.59).

### Worked example 2 — a chorus that comes back
`Sections: … bars 17–24 part B (chorus): drums, bass, other, vocals · … bars 41–48 part B (chorus) …`. Make the two
choruses rhyme: the same framing order on the same bar numbers inside each (bar 17 ↔ 41 wide, 19 ↔ 43 singer
close-up, 21 ↔ 45 drummer). Ask `analyze {what:"music", from:<chorus start>, to:<+16 s>}` once and place the cuts on
its snare hits; the words with times put each lyric caption exactly (`captions` does this by itself).

### Mistakes to avoid
- A singing mouth where `no vocals` — the viewer sees the lie at once. Singer shots only inside a phrase's
  start–end (± 0.2 s), never across `No voice` stretches.
- A drummer hitting where the drums have stopped (`stop at …`, `Breaks`), a guitarist strumming where `other` is not
  in the bar's parts, a bassist where `Bass plays` doesn't cover the time.
- Cutting between bar lines in a steady part: use the `Bar starts` times as they are (or a beat from detail).
- Planning from the full mix's genre or the song's name; computing anything in a shell; asking the user what plays.
- Judging the song from one stem: the score already reads all four; `separate_voice` (two clips, voice and music) is
  for mixing, not for hearing.
- Speech notes (hum, noise, sibilance, «speaks») are for talk; on a song ignore them.

## Ask the sound in English (hearing)
- `analyze {what:"audio"}` also says what it hears: «Heard (AudioSet tagger on this Mac): Rain 74 % · …», and names
  per stretch («music: sad music, piano»).
- `sounds_like {like:["crowd cheering", "tense build-up", "sad piano"], id? | from, to, find?, window?}` → 0–100 per
  phrase with the closest everyday sounds; `find:true` says where it sounds most like each (the applause, the drop,
  the calm part, a door slam). Use it to pick music for a mood and to find a moment by its sound.
- **Ask in English**: the hearing model (CLAP) reads English only — translate the user's words yourself
  («аплодисменты» → "applause", «напряжённое нарастание» → "tense build-up"). A Russian phrase falls back to the few
  measured concepts (silence, speech, hum).
- The hearing models download on first use (the app's job list shows it). Until they are on the Mac the answers say
  «Measured, not heard: … downloading now, 37 %»: use the measured result and go on; ask again later if hearing it
  matters.

## Cut on the right points
- `edit` `split` / `trim` / `cut_out` / `remove_pauses` land on Gaziyav's cut points by themselves: inside a pause,
  never in a word or a breath, room tone kept, 10 ms fades at the seams, linked sound in sync (`exact:true` turns
  the snapping off).
- A cut near a time: `analyze {what:"cut_points", at: 12.4}` or after word #n: `{what:"cut_points", after: 57}` →
  the frame-exact time; with music: on a beat or the end of a bar.
- Natural pauses: keep the speaker's own pause length (the map says it); never cut every pause to zero.

## Check every cut, fix, check again
1. `check_cuts {}` (or `{from, to}`) — each cut checked by ear: level jumps, clicks, a word or breath cut off, an
   unnatural pause, a silence hole, music off the beat — each with its exact fix.
2. `check_cuts {fix:true}` applies the fixes (one undo) and says what changed.
3. `check_cuts {}` again: done when it reports nothing.

## Levels and mix
- Voice peaks −6…−3 dB; music −18…−14 dB under speech, louder only where nobody talks. Music on a library clip ducks
  under voices by itself (`duckUnderVoice`); set it with `edit set {id:"music", params:{volume:-16}}`.
- What `analyze audio` flags, fix with `fix_sound {id, what}`: noise, hum (`hz` 50/60), mud, sibilance, echo, level,
  duck, quieter / louder (`db`). By hand: `{op:"set", id, params:{"fx.denoise":true, "fx.voice":true,
  "fx.voice.bands":"podcast"}}`; heavy noise `{op:"ai_effect", id, kind:"enhance_voice"}`; stems `kind:"separate_voice"`.
- Music under a cut: `fit_music {id, length}` (or `end`) — it ends on a bar line with a one-bar fade, or loops whole
  bars when the track is short. Do it after the cut is final, before export.
- Export brings the mix to −14 LUFS with a platform preset.

## Sound design
A whoosh 0.1–0.2 s before a whip transition, a pop on a title or a callout, a riser into a reveal, an impact on
the drop: `find_content {kind:"sound", query:"whoosh"}` → `place {item:"sound:…", at}`. Few, and only on something
the viewer sees. Never leave dead silence between voice lines: keep the music bed or room tone.

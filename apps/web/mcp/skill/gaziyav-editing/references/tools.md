# The tools, with example calls

| Tool | When | Example |
|---|---|---|
| `project` | start, settings, the brief | `{action:"create", name:"Reel", aspect:"9:16"}` · `{action:"notes", notes:"reels, clean-premium, hook = quote 2"}` |
| `get_project` | once, then `since` | `{}` · `{since: 42}` · `{id:"title at 0:01"}` (its settings) · `{track:"<id>"}` |
| `status` | instead of waiting, sleeping or shell | `{}` (what runs, how far, what finished) · `{cancel:"all"}` (the user said stop) |
| `get_project` media | new files with ids | `{media:"new"}` (newest first, AI ones by their prompt) |
| `analyze_material` | before planning | `{brief:"рилс из этого"}` · `{media:["<id>"]}` |
| `analyze` | words, audio, cut points, beats | `{what:"words"}` · `{what:"cut_points", after: 57}` · `{what:"beats", id:"music"}` |
| `find_content` | anything to add | `{kind:"music", query:"lofi"}` · `{kind:"motion", query:"lower third"}` · `{kind:"stock", query:"city night"}` · `{kind:"local", query:"interview"}` |
| `import_media` | bring files in | `{paths:["/Users/me/Movies/talk.mp4"]}` · `{youtube:"https://youtu.be/…", from:30, to:42}` |
| `place` | put items on the timeline | `{item:"music:lofi-01", at:0}` · `{items:[{item:"text:hook-bold", text:"3 MISTAKES", at:0, duration:2}, {item:"filter:warm-film", on:"all"}]}` |
| `apply_plan` | build a whole edit (or a production script) | `{brief:"промо для товара, дорого"}` · `{recipe:"reel-talking-head", platform:"reels", seconds:30, beats:[{quote:1},{quote:3}], cta:"Follow"}` |
| `edit` | every change, batched | `{ops:[{op:"split", time:3.2}, {op:"delete", ids:["clip 2"], closeGap:true}, {op:"set", id:"music", params:{volume:"-=3"}}]}` |
| `motion_layer` | graphics, charts, kinetic type | `{kind:"Counter", props:{value:250, suffix:"K"}, start:4}` · `{code, component:"BarChart", props:{data:[…]}, start:6, duration:4}` |
| `generate` | AI (priced, within budget) | `{kind:"image", prompt, cast:["Anna"], place:false}` · `{kind:"video", mode:"image", from:"<id>", duration:5, model:"cheapest"}` · `{…, from:"<clip id>@last"}` (the next shot) · `{kind:"voice", text, speaker:"ryan", start:12}` (paid by characters) · `{kind:"lipsync", id, sound:"timeline", model:"cheapest"}` (one clip a call) |
| `price_plan` | before paid steps | `{budget:5, items:[{kind:"image", model:"cheapest", refs:2, count:6}]}` · `{kind:"video"}` (models) |
| `review` | the quality gate | `{platform:"reels"}` · `{fix:true}` · `{waive:["<check id>"]}` (the user's choice) |
| `check_cuts` | every audio cut by ear | `{}` · `{fix:true}` |
| `fix_sound` / `fit_music` | a sound problem / music to the cut's length | `{id, what:"noise"}` · `{id:"music", length:30}` |
| `sounds_like` | your own questions to the sound, in English | `{like:["applause", "sad piano"], id:"music", find:true}` |
| `look` | see it (the timeline, up to 8 frames; or a Media file's own frames) | `{at:[0.5, 4.2, 12, 29]}` · `{what:"playback", from:0, to:6}` · `{what:"media", ids:["<id>"], at:[723, 725]}` · `{what:"media", ids:["<id>"], count:6}` (a contact sheet) |
| `export` | a file; the answer is the file itself, checked (length, sound, black or silent stretches) with three of its frames | `{platform:"reels", cover:"1.2"}` |
| `post` | publish after one yes | `{platforms:["youtube","tiktok"], title, description, hashtags}` → then `{…, confirm:true}` |
| `memory` | cast and voices for every project | `{action:"cast", name:"Anna", images:["<id>"], description:"red hair, 25"}` |
| `taste_profile` | platform, preset, budget, brand kit | `{set:{budget:3, brand:{accent:"#FF2E4D"}}}` |
| `undo` | take back your last changing call (the answer names it) | `{}` · `{steps:2}` |
| `scenes` | a long film's structure: list, find, reorder, rename, merge, split, delete, copy out, YouTube chapters | `{action:"find"}` · `{action:"list"}` · `{action:"move", scene:4, before:2}` (its captions and titles go with it, music beds stay) · `{action:"rename", titles:["Port", "Bridge", "Market"]}` (all in one call) · `{action:"rename", scene:2, title:"The storm"}` · `{action:"youtube"}` (last) |

Words for targets: `selected`, `this`, `music`, `voice`, `captions`, `title`, `title at 0:05`, `text at 5`, `clip 2`,
`second clip`, `last clip`, `clip at 0:12`; times: `playhead`. Relative numbers in `set`: `+=3`, `-=3`, `*=1.2`, `+=20%`.
"$1" in an `edit` step is the id step 1 made.

Batch generation: `generate {items:[{kind:"video", mode:"image", from:"<pic>", prompt:"…", duration:5, start:12}, …]}`
starts up to 8 shots at once and answers within 45 s with what finished (ids) and what still runs; the same call
again collects the rest. Steps in `edit {ops}` / `place {items}`: `"$prev"` is the id the step before made;
`{…, as:"s1"}` names one for a later `"$s1"`. Unknown arguments are refused with the valid ones: read them, don't guess.

# Titles, colour, transitions, framing

## Titles and plates
- Hook title on the first frame: `find_content {kind:"text", query:"hook"}` → `place {item:"text:<style>", text, at:0, duration:2}`.
- Plates, lower thirds, CTAs, counters, sale tags: `find_content {kind:"motion"}` → `place {item:"motion:<kind>", fields}`
  or your own `motion_layer` (topic motion). Callouts, badges and arrows are motion too (Gaziyav has no stickers).
- Two fonts, one accent colour (the brand kit's when there is one); animate in ≤ 0.3 s, out before the cut.
- 9:16 safe zone: nothing in the top 220 px, bottom 420 px, right 140 px, left 60 px. Positions in `set` are px from the
  canvas centre: y −960 is the top edge, +960 the bottom.
- Pin a text or a picture to a moving face: `{op:"track", id, kind:"face"}` then `{op:"follow", id:<text>, clip:<video>}`.

## Colour
- Flat or mismatched clips: `{op:"auto_color", id}` on each.
- One look for the whole piece: `find_content {kind:"filter", query:"warm film"}` → `place {item:"filter:<look>", on:"all"}`
  (a different look per clip reads as a mistake). Strength after: `{op:"set_effect", id, effect:"studio.color", params:{lookIntensity:0.6}}`.
- Brighter / punchier: `place {item:"effect:studio.color", on:"selected", fields:{exposure:0.25, contrast:0.1, saturation:0.1}}`
  (`get_project {id}` lists the keys of the effect after).
- Background: `{op:"ai_effect", id, kind:"remove_background"|"blur_background"}` (free, on this Mac).

## Transitions
Plain cuts carry most of the edit. Two or three transitions in 30 s at most, on cuts that change place or time, on a
beat: `find_content {kind:"transition", query:"whip"}` → `place {item:"transition:<type>", at:<cut time>}` + a whoosh.

## Framing and speed
- Horizontal footage for a vertical video: `{op:"make_vertical", aspect:"9:16"}` keeps the person in frame.
- Punch-ins hide jump cuts: `{op:"camera", id:"clip 3", move:"punch_in", amount:0.12}`; slow push-in on a key line:
  `move:"push_in", amount:0.08`. Stills: `ken_burns`.
- Speed ramps: `{op:"speed", id, rate:0.5, opticalFlow:true}` (smooth slow motion), `rate:2` for hype.

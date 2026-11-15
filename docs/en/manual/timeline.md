# The timeline

[← Manual](README.md)

**What it is for.** One project, one timeline: a magnetic main track for the story, tracks above for titles, overlays and captions, tracks below for sound.

**The same gestures for every kind of clip** (video, overlay, audio, title, caption, shape, compound clip):

| Gesture | Means |
|---|---|
| Drag the body | Move |
| Drag an edge | Trim (every clip shows a handle at both edges at every zoom) |
| <kbd>⌥</kbd> + drag | Copy |
| <kbd>⇧</kbd> + click / <kbd>⌘</kbd> + click | Add to / toggle in the selection |
| Hold <kbd>⌘</kbd> while dragging | Drag freely, without snapping |
| Right-click | The clip's menu, the same for every kind of clip |
| <kbd>Esc</kbd> | Cancel the drag in progress → close what is open → clear the selection |

**The shortest paths.**
- Split at the playhead <kbd>⌘B</kbd> (all tracks <kbd>⇧⌘B</kbd>); the Split tool <kbd>B</kbd> cuts where you click.
- Delete <kbd>⌫</kbd>; ripple delete (close the gap) <kbd>⇧⌫</kbd>.
- Copy, cut, paste <kbd>⌘C</kbd> <kbd>⌘X</kbd> <kbd>⌘V</kbd> (paste inserts at the playhead and pushes later clips); paste over <kbd>⌥V</kbd>; duplicate <kbd>⌥D</kbd>.
- Nudge a frame <kbd>,</kbd> <kbd>.</kbd>, ten frames <kbd>⇧,</kbd> <kbd>⇧.</kbd>.
- Select from the playhead forward <kbd>]</kbd>, up to it <kbd>[</kbd>; next / previous clip <kbd>⌘→</kbd> <kbd>⌘←</kbd>.
- Zoom <kbd>⌘=</kbd> <kbd>⌘-</kbd>, fit <kbd>⇧Z</kbd>; enable / disable a clip <kbd>V</kbd>, mute it <kbd>⇧V</kbd>.

**The three switches.**
- **Magnet** <kbd>P</kbd>: the main track has no gaps. Deleting or shortening a clip closes up the rest; lengthening it pushes what follows. Elsewhere a longer clip keeps its start and stops at its neighbour. <kbd>⌘Z</kbd> never brings back a gap under an active magnet.
- **Snapping** <kbd>N</kbd>: edges catch on cuts, the playhead and markers.
- **Linkage** <kbd>`</kbd>: a clip's own sound moves with it; detach it with <kbd>⌃⇧S</kbd>.

**Good to know.**
- Every change is exactly one undo step. An automated test runs every command and checks the timeline rules after each one: 930 runs, none broken.
- These rules hold after every step: clips on one track never overlap, every clip stays inside its source, the main track has no gaps.
- A clip is never shorter than one frame and never grows into its neighbour.

Next: [Trimming](trimming.md) · [Compound clips](compound.md)

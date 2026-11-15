# The timeline

**English** · [Русский](../ru/timeline.md)

A project has one timeline. Everything on it (video, a clip on an upper track, audio, a title, a caption, a shape, a compound clip) follows the same rules.

## The rules

| Gesture | What it does, on every kind of clip |
|---|---|
| Drag the body | Move |
| Drag an edge | Trim. Every clip shows a handle at both edges at every zoom; the edge under the pointer lights up. |
| <kbd>⌥</kbd> + drag | Copy |
| <kbd>⇧</kbd> + click | Add to the selection |
| <kbd>⌘</kbd> + click | Toggle in the selection |
| Hold <kbd>⌘</kbd> while dragging | Drag freely, without snapping |
| <kbd>Esc</kbd> | Cancel the gesture in progress → close what is open → clear the selection. It never takes you to another screen. |
| Right-click | The clip's menu, the same layout for every kind of clip |

You can do every core action with the **keyboard only** or with the **trackpad only**.

## The three switches

- **Magnet** <kbd>P</kbd>: the main track has no gaps. Deleting or shortening a clip closes up; lengthening pushes what follows. On other tracks a longer clip keeps its start and stops at its neighbour. Undo remembers the magnet too: <kbd>⌘Z</kbd> never brings back a gap while the magnet is on.
- **Snapping** <kbd>N</kbd>: edges catch on cuts, the playhead and markers.
- **Linkage** <kbd>`</kbd>: a clip's own sound moves with it. Detach the sound with <kbd>⌃⇧S</kbd>.

## Trimming

- **Select tool** <kbd>A</kbd>: at a cut, the left zone is the outgoing clip's end and the right zone the incoming clip's start; <kbd>⌥</kbd> on either side ripples that edge. The Select tool never rolls.
- **Trim tool** <kbd>T</kbd> (or hold <kbd>T</kbd>): roll a cut, ripple an edge, slip a clip's content.
- Pick an edge from the keyboard: <kbd>⇧[</kbd> outgoing end, <kbd>⇧]</kbd> incoming start, <kbd>\\</kbd> both (roll). Then <kbd>,</kbd> <kbd>.</kbd> move it one frame, <kbd>⇧,</kbd> <kbd>⇧.</kbd> ten.
- Type a number: <kbd>=</kbd> or <kbd>-</kbd>, then frames or a timecode, <kbd>↵</kbd>.
- **Trim while it plays:** <kbd>⇧/</kbd> loops the selected cut and lets you trim it on the fly with <kbd>J</kbd> <kbd>L</kbd> <kbd>,</kbd> <kbd>.</kbd>.
- **To the playhead:** <kbd>Q</kbd> trims the start, <kbd>W</kbd> the end. **Slip:** <kbd>⌥,</kbd> <kbd>⌥.</kbd>.

A clip is never shorter than one frame and never grows into its neighbour.

## Compound clips

Select clips → <kbd>⌥G</kbd> makes a compound clip. <kbd>⌘↓</kbd> opens the selected compound clip, <kbd>⌘↑</kbd> goes back out, with the parent's playhead, zoom and scroll restored level by level. Duplicates of a compound share its contents. <kbd>⌥⇧G</kbd> takes it apart.

Older projects with several timelines open with the extra ones as **compound clips in Media**: double-click to open, drag to place. Nothing is converted until you edit, and a «before joining» version is kept.

## Undo

Every change is one history step: one <kbd>⌘Z</kbd> brings back the exact state before it, <kbd>⇧⌘Z</kbd> the state after. Automated tests went through every command, 930 runs: every change was one step, and no timeline rule broke. A model-based test also drives the editor core through 1 500 random sequences of 300 steps, checking after every step.

The rules checked after each step: no two clips of a track overlap; every clip stays inside its source; the magnetic main track has no gap; ids are unique; the selection names only what is there; undo and redo are byte-for-byte.

## Saving

Gaziyav saves by itself: a new clip at once, any other edit within a quarter of a second (at most three seconds while you keep editing). A drag in progress is not a change until you drop it. <kbd>⌘S</kbd> saves right away if you want.

[Every shortcut →](shortcuts.md)

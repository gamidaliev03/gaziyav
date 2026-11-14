# Trimming

[← Manual](README.md)

**What it is for.** Making cuts land on the exact frame — with the mouse, by keys, by numbers, or while it plays.

**How.**
- **Select tool** <kbd>A</kbd>: at a cut, the left zone is the outgoing clip's end, the right zone the incoming clip's start; <kbd>⌥</kbd> on either side ripples that edge. The Select tool never rolls.
- **Trim tool** <kbd>T</kbd> (or hold <kbd>T</kbd>): roll a cut, ripple an edge, slip a clip's content.
- **To the playhead:** <kbd>Q</kbd> trims the start, <kbd>W</kbd> the end; <kbd>E</kbd> extends the edit to the playhead.
- **From the keys:** pick an edge — <kbd>⇧[</kbd> outgoing end, <kbd>⇧]</kbd> incoming start, <kbd>\</kbd> both (roll) — then <kbd>,</kbd> <kbd>.</kbd> one frame, <kbd>⇧,</kbd> <kbd>⇧.</kbd> ten.
- **One frame without picking:** <kbd>⌥⌘←</kbd> <kbd>⌥⌘→</kbd> move the end, <kbd>⌥⇧⌘←</kbd> <kbd>⌥⇧⌘→</kbd> the start.
- **By number:** <kbd>=</kbd> or <kbd>-</kbd>, type frames or a timecode, <kbd>↵</kbd>. With nothing selected it moves the playhead.
- **Slip:** <kbd>⌥,</kbd> <kbd>⌥.</kbd> (ten: <kbd>⌥⇧,</kbd> <kbd>⌥⇧.</kbd>); by number <kbd>⌥=</kbd> <kbd>⌥-</kbd>.
- **While it plays:** <kbd>⇧/</kbd> loops the picked cut; trim it on the fly with <kbd>J</kbd> <kbd>L</kbd> <kbd>,</kbd> <kbd>.</kbd>.

**Rules that surprise people.**
- On the magnetic main track a ripple pushes or pulls everything after it; elsewhere a trim stops at the neighbour.
- A trim never goes past the source: the clip shows where its media ends.

**Limits.** A clip is at least one frame long.

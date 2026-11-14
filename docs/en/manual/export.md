# Export

[← Manual](README.md)

**What it is for.** A finished file — for a platform, for a client, for an archive.

**How.**
- <kbd>⌘E</kbd> or **Export** at the top right.
- Pick resolution (up to 8K), format (MP4, MOV, WebM, GIF), codec (H.264, HEVC, AV1, Apple ProRes, VP9), frame rate (23.976 to 60), bit rate, colour space and the audio.
- A range only: set in / out (<kbd>I</kbd> <kbd>O</kbd>) first.
- Faster encoding on the graphics chip: Settings → Performance → «Speed up hardware encoding».

**Rules that surprise people.**
- Every export is free: no watermark, no subscription for 4K, 8K or 60 fps.
- Exact to the frame: 72 of 72 export cases (every frame rate, with and without frame smoothing) checked with `ffprobe`; a 10-minute 60 fps film came out with all 36 017 frames and the sound ending within 0.3 ms of the picture.
- Guides and markup in the player never reach the file.
- When an export finishes while Gaziyav is in the background it can notify you (Settings → General).

Then: [Post from the editor](post.md).

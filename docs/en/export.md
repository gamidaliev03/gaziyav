# Export

**English** · [Русский](../ru/export.md)

Press <kbd>⌘E</kbd> (or **Export** at the top right). The defaults follow the project: its shape, its frame rate, H.264 in MP4. No watermark is added.

## What you can make

| | Options |
|---|---|
| Video codecs | H.264, HEVC, AV1, Apple ProRes, VP9 |
| Containers | MP4, MOV, WebM, GIF |
| Resolution | 480p, 720p, 1080p, 2K, 4K, 8K |
| Frame rate | 23.976, 24, 25, 29.97, 30, 50, 59.94, 60 |
| Also | sound alone (MP3 and others), a GIF, a cover picture, the selected clips as separate files, HDR / 10-bit |

H.264 in MP4 / MOV and VP9 in WebM are drawn and encoded directly. HEVC, AV1, ProRes, GIF and HDR / 10-bit are made by ffmpeg from a high-bit-rate H.264 master, so every format has exactly the same frames.

**Smooth frames** raises the frame rate (for example 30 → 60) by interpolating new frames on your Mac.

## Exact to the frame

What was checked:

- The number of frames in the file equals the timeline's length at that frame rate, the last frame included. This holds for every rate above, plain and with a cover, with and without Smooth frames: **72 of 72 cases** exact under `ffprobe -count_frames`.
- The first frame after a cover is timeline frame 0, the last is frame N − 1, and every frame is in order.
- The frame rate is the exact fraction (24000/1001, not 23.98).
- The sound ends within one frame of the picture, with no AAC tail running past it.
- A 10-minute 60 fps film: **36 017 frames, all in order, sound −0.3 ms**, in one pass.

## Covers

Click **Edit cover** in the Export window to pick a frame or a picture as the cover. It is written as the file's first frames and as its thumbnail.

## Platforms

You can save the platform you post to most; its settings open by themselves next time. Before posting, turn on the guides in the player (<kbd>⇧⌘;</kbd>) to see where the platform's buttons cover the picture. The guides never appear in the export.

## Share → Post

After export, **Share** opens the platform's own upload page in a Gaziyav window. You sign in there yourself (the sign-in stays in that window, as in a browser), and the video is handed over. Gaziyav never sees your password.

## Exporting while you work

Export runs in the background, with its progress in the activity list and the Dock, so you can keep editing. Cancel stops it.

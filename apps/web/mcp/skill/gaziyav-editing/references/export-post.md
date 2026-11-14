# Export and post

## Export (a file)
`export {platform}` sets size, quality and loudness (−14 LUFS): `tiktok`, `reels`, `shorts` (9:16), `youtube` (16:9),
`feed` (4:5), `vk`, `telegram`. Or set it yourself: `quality` low|medium|high|very_high, `resolution` (short side
720 / 1080 / 1440 / 2160), `fps`, `format` mp4|mov|webm, `from`/`to` (a range), `loudness`, `cover` (seconds of the
timeline or a Media picture id — shown as the first frames), `name`, `folder` (default ~/Movies/Gaziyav). It says where
the file is, its size and how long it took. Export only when a file is wanted; posting renders by itself.
One Media item as its own file: `export {media: <id>}`.

If `review` found hard failures, export says so: fix them (or `review {waive:[…]}` with the user's reason) and export again.

## Post (YouTube Shorts, Instagram Reels, TikTok)
The accounts are the ones the user connected once in Gaziyav → Settings → Share. Short vertical videos only (up to 3
min on Shorts and Reels, 10 on TikTok); a long YouTube video is a file for the user.
1. `post {platforms?, title, description, hashtags, privacy?, at?, cover?}` without `confirm` — nothing is posted; it
   checks the accounts, the text against each platform's limits, the video, and returns exactly what would go out.
2. Show that summary to the user and ask once: «Post it?».
3. After their yes: the same call with `confirm:true` — it renders, posts, waits and returns each post's link (TikTok's
   comes a few minutes later). A failure says why; fix it and post only the failed platform again.
- Text: a title for YouTube (≤ 100 characters), the description, 3–8 hashtags (Instagram allows 30), in the video's
  language. `at` schedules (ISO time). A non-vertical project needs `vertical:true` (a 9:16 copy is posted).
- `post {check:true}` lists the recent posts and their state.

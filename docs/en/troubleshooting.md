# Troubleshooting

**English** · [Русский](../ru/troubleshooting.md)

## The app will not open

- **«Apple could not verify…» / «cannot be opened»** — [the first-open steps](install.md#open-it-the-first-time-macos-15-sequoia-and-later).
- **«…is damaged and can't be opened»** — [download again, check the checksum, then the last resort](install.md#gaziyav-is-damaged-and-cant-be-opened).
- **The first open takes long** — macOS checks a large new app once; later opens are fast.

## AI buttons

| You see | Do this |
|---|---|
| The button asks for a key | **Settings → AI → fal.ai**, paste your key, Save. |
| «not enough balance» or similar | Add credit in your fal.ai dashboard, then **Retry** on the run. Nothing was lost. |
| A timeout | **Retry** — the message says how long it actually waited. Long clips are split into pieces; a failed piece retries by itself once. |
| The price shows a spinner | Gaziyav is computing the exact plan; the price appears before anything can be sent. |
| A confirmation every time | Raise «Confirm spending above» in **Settings → AI**. |
| The lips look off | Try a stronger model from the list — its price for this clip is shown. Sync lipsync‑2 handles head turns and close-ups better. |

## Captions or local tools

The first use of captions, voice clean-up or separation downloads a model and shows its size and progress in the activity list. If the download host cannot be reached, it says so within seconds and offers **↻**; an interrupted download resumes from where it stopped.

## Import by link

Make sure the link opens in a browser. If a site changed and imports start failing, Gaziyav fetches a newer, signature-checked yt-dlp on its own (at most once a day); try again a minute later.

## Export

- **Slow:** close other heavy apps; Smooth frames and ProRes / HEVC / AV1 take extra passes.
- **The file looks different in another player:** check the colour space in Export → More options (Rec. 709 SDR is the safe default).
- **The platform cut my text off:** turn on the guides with <kbd>⇧⌘;</kbd> before exporting.

## The timeline does something unexpected

<kbd>⌘Z</kbd> always brings back the state before the last change, exactly. If you can repeat the surprise, [file a bug](https://github.com/gamidaliev03/gaziyav/issues/new?template=bug.yml) with the steps — the timeline has automated rules and every reproducible break becomes a test.

## Still stuck

[Open an issue](https://github.com/gamidaliev03/gaziyav/issues/new/choose) with your macOS version (or your browser, for the browser edition), the Gaziyav version (**Gaziyav → About**) and what you did. Do not paste your API keys.

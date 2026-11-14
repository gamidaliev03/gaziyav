# Install

**English** · [Русский](../ru/install.md)

- [macOS](#macos) — Apple silicon, macOS 14 Sonoma or later
- [Any other computer](#any-other-computer-the-browser-edition) — Windows, Linux, a Chromebook: the browser edition, nothing to install

## macOS

1. Download `Gaziyav-<version>-arm64.dmg` from [Releases](https://github.com/gamidaliev03/gaziyav/releases/latest). Download it **only** from that page.
2. Open the `.dmg` and drag **Gaziyav** onto **Applications**.
3. Open Gaziyav from Applications.

The app needs an Apple silicon Mac (M1 or later) and macOS 14 or later.

### «Apple could not verify…» — why it appears

Apple shows this for every app that has not been through its paid notarisation service. Gaziyav is signed but not notarised yet (it is on the [roadmap](../../README.md#roadmap)). The warning does not mean something is wrong with the file — but it is a real safety check, so open the app this way only if you downloaded it from this repository's Releases page.

### Open it the first time (macOS 15 Sequoia and later)

On current macOS the Control-click shortcut no longer skips the check. Use Apple's own way:

1. Try to open Gaziyav once. macOS shows the warning; click **Done**.
2. Open **System Settings → Privacy & Security**.
3. Scroll down to **Security**. Next to the line about Gaziyav, click **Open Anyway**. The button is there for about an hour after you tried to open the app.
4. Enter your login password, then click **Open** in the warning that follows.

macOS remembers this: from now on Gaziyav opens with a double-click like any app.

### macOS 14 Sonoma

Control-click (or right-click) Gaziyav in Applications → **Open** → **Open**. If that does not offer an Open button, use the System Settings way above.

### «Gaziyav is damaged and can't be opened»

This message usually means the download was cut short or changed on the way, not that the app is broken. In order:

1. Delete the app and the `.dmg`, download again from [Releases](https://github.com/gamidaliev03/gaziyav/releases/latest), and compare the file's checksum with the one in the release notes:
   ```sh
   shasum -a 256 ~/Downloads/Gaziyav-*.dmg
   ```
2. Try the **Open Anyway** steps above.
3. **Last resort**, only for a copy whose checksum matched: remove the «downloaded from the internet» flag from this one app.
   ```sh
   xattr -dr com.apple.quarantine /Applications/Gaziyav.app
   ```
   What it does: your browser marks every downloaded file with a quarantine flag, and macOS checks flagged apps on first open. This command removes the flag from Gaziyav only, so macOS will not run that first-open check for it. It changes nothing else on your Mac.

Never turn Gatekeeper off for the whole system to run any app — this one included.

### Update and uninstall

To update, download the new `.dmg` and replace the app in Applications; your projects stay. To uninstall, move Gaziyav to the Bin. Its data lives in `~/Library/Application Support/Gaziyav` — delete that folder too if you want every project, model and setting gone.

## Any other computer: the browser edition

There is a Mac app and a browser edition — nothing else to download. On Windows, Linux, a Chromebook or any computer that is not a Mac, [open the editor in your browser](https://gamidaliev03.github.io/gaziyav/editor/): no install, no account, no server. It runs on your own hardware, your files never leave the tab, and after the first open it works offline. A recent desktop browser (Chrome, Edge) works best.

**What it has:** the timeline and its grammar, titles, effects, transitions, filters, looks, import of your own files and export — and **lipsync (beta), with your own fal.ai key**: the key stays in this browser and goes only to fal.ai.

**Only in the Mac app:** Claude inside Gaziyav, the free on-device AI (captions from speech, pause removal, voice clean-up and the rest), a clip by link, posting from the editor, and long, heavy exports.

Projects in the browser live in that browser's storage: clearing the site's data clears them, so export what you want to keep. More: [the browser edition](manual/browser.md). The tour as slides opens there too: `https://gamidaliev03.github.io/gaziyav/tour/`.

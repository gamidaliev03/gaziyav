# Install

**English** · [Русский](../ru/install.md)

- [macOS](#macos): Apple silicon, macOS 14 Sonoma or later
- [Any other computer](#any-other-computer-the-browser-edition): the browser edition for Windows, Linux or a Chromebook, nothing to install

## macOS

1. Download `Gaziyav-<version>-arm64.dmg` from [Releases](https://github.com/gamidaliev03/gaziyav/releases/latest). Download it **only** from that page.
2. Open the `.dmg` and drag **Gaziyav** onto **Applications**.
3. Open Gaziyav from Applications.

The app needs an Apple silicon Mac (M1 or later) and macOS 14 or later.  There is one download: the same full build the author edits with. The music and sound library and the on-device AI models are not inside it; each file downloads the first time you use it.

### «Apple could not verify…»: why it appears

Apple shows this for any app that has not gone through its paid notarisation. Gaziyav is signed but not notarised yet (it is on the [roadmap](../../README.md#roadmap)). The warning does not mean the file is broken. It is still a real safety check, so open the app this way only if you downloaded it from this repository's Releases page.

### Open it the first time (macOS 15 Sequoia and later)

On current macOS, Control-click no longer skips the check. Use Apple's own way:

1. Try to open Gaziyav once. macOS shows the warning; click **Done**.
2. Open **System Settings → Privacy & Security**.
3. Scroll down to **Security**. Next to the line about Gaziyav, click **Open Anyway**. The button stays there for about an hour after you tried to open the app.
4. Enter your login password, then click **Open** in the warning that follows.

macOS remembers this. From then on, Gaziyav opens with a double-click like any app.

### macOS 14 Sonoma

Control-click (or right-click) Gaziyav in Applications → **Open** → **Open**. If there is no Open button, use the System Settings way above.

### «Gaziyav is damaged and can't be opened»

This message usually means the download was cut short or changed on the way, not that the app is broken. Try these in order:

1. Delete the app and the `.dmg`, download again from [Releases](https://github.com/gamidaliev03/gaziyav/releases/latest), and compare the file's checksum with the one in the release notes:
   ```sh
   shasum -a 256 ~/Downloads/Gaziyav-*.dmg
   ```
2. Try the **Open Anyway** steps above.
3. **Last resort**, only for a copy whose checksum matched: remove the «downloaded from the internet» flag from this one app.
   ```sh
   xattr -dr com.apple.quarantine /Applications/Gaziyav.app
   ```
   What it does: your browser marks every downloaded file with a quarantine flag, and macOS checks flagged apps on first open. This command removes the flag from Gaziyav only, so macOS skips that first-open check for it. It changes nothing else on your Mac.

Don't turn Gatekeeper off for the whole system, for this app or any other.

### Update and uninstall

To update, download the new `.dmg` and replace the app in Applications; your projects stay. To uninstall, move Gaziyav to the Bin. Its data lives in `~/Library/Application Support/Gaziyav`; delete that folder too if you want every project, model and setting gone.

## Any other computer: the browser edition

Besides the Mac app there is only the browser edition. On Windows, Linux, a Chromebook or any other computer, [open the editor in your browser](https://gamidaliev03.github.io/gaziyav/editor/): no install, no account. After the first open it also works offline. A recent desktop browser (Chrome, Edge) works best.

**What it has:** the timeline, titles, effects, transitions, filters, generators, the whole music and sound library, looks, import and export, captions from speech with pause removal, and lipsync (beta), AI image and AI video on your own fal.ai key.

**Only in the Mac app:** Claude inside Gaziyav, the other on-device AI tools (voice clean-up, background removal, retouch and more), a clip by link, posting from the editor, a voice from text, motion graphics, and long, heavy exports.

Projects in the browser live in that browser's storage. Clearing the site's data deletes them, so export what you want to keep. More: [the browser edition](manual/browser.md). The tour as slides: `https://gamidaliev03.github.io/gaziyav/tour/`.

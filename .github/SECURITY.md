# Security

**English** · [Русский](#по-русски)

## Reporting a vulnerability

Please **do not** open a public issue. Report privately through GitHub: **Security → Report a vulnerability** on this repository ([direct link](https://github.com/gamidaliev03/gaziyav/security/advisories/new)).

Include what you found, how to reproduce it, and what an attacker could do with it. You will get an answer as soon as a maintainer can look; please give us a reasonable time to fix it before you publish.

## What is in scope

- the Mac app and the browser edition;
- how API keys are stored and sent (encrypted with the system keychain; sent only to the provider they belong to);
- anything that makes the app send data that [the privacy note](../docs/en/privacy.md) does not list;
- the update path of the bundled link downloader (accepted only with yt-dlp's own signature) and the model / library downloads (checked by SHA-256).

## Builds

Only binaries attached to this repository's [Releases](https://github.com/gamidaliev03/gaziyav/releases) are ours. The macOS app is signed but not notarised yet — check the SHA-256 in the release notes before opening a download.

---

## По-русски

Об уязвимостях — **не в открытых задачах**, а приватно: на странице репозитория **Security → Report a vulnerability** ([прямая ссылка](https://github.com/gamidaliev03/gaziyav/security/advisories/new)). Опишите, что нашли, как повторить и что это даёт атакующему, и дайте нам разумное время на исправление до публикации. Наши сборки — только те, что приложены к [выпускам](https://github.com/gamidaliev03/gaziyav/releases); сверяйте SHA-256 из описания выпуска.

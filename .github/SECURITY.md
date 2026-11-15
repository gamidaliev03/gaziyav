# Security

**English** · [Русский](#по-русски)

## Reporting a vulnerability

Please **do not** open a public issue. Report privately through GitHub: **Security → Report a vulnerability** on this repository ([direct link](https://github.com/gamidaliev03/gaziyav/security/advisories/new)).

Include what you found, how to reproduce it, and what an attacker could do with it. A maintainer will answer as soon as possible. Please give us reasonable time to fix it before you publish.

## What is in scope

- the Mac app and the browser edition;
- how API keys are stored and sent (encrypted with the system keychain; sent only to the provider they belong to);
- anything that makes the app send data that [the privacy note](../docs/en/privacy.md) does not list;
- the update path of the bundled link downloader (accepted only with yt-dlp's own signature) and the model and library downloads (checked by SHA-256).

## Builds

Only the files attached to this repository's [Releases](https://github.com/gamidaliev03/gaziyav/releases) are ours. The macOS app is signed but not notarised yet. Check the SHA-256 in the release notes before you open a download.

---

## По-русски

Об уязвимостях сообщайте **не в открытых задачах**, а приватно: на странице репозитория **Security → Report a vulnerability** ([прямая ссылка](https://github.com/gamidaliev03/gaziyav/security/advisories/new)). Опишите, что нашли, как это повторить и что это даёт атакующему. Сопровождающий ответит, как только сможет. Пожалуйста, дайте нам разумное время на исправление до публикации.

Что входит: приложение для Mac и версия для браузера; хранение и отправка API-ключей (они зашифрованы системной связкой ключей и уходят только своему сервису); любые данные, которые приложение отправляет помимо перечисленных в [заметке о приватности](../docs/ru/privacy.md); обновление встроенного загрузчика по ссылке (принимается только с подписью yt-dlp) и загрузка моделей и библиотеки (сверка по SHA-256).

Наши сборки — только файлы, приложенные к [выпускам](https://github.com/gamidaliev03/gaziyav/releases). Приложение для macOS подписано, но пока не нотариально заверено Apple. Сверяйте SHA-256 из описания выпуска, прежде чем открывать загрузку.

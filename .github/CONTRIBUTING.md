# Contributing to Gaziyav

**English** · [Русский](#по-русски)

Thank you for wanting to help. The most valuable contributions right now, in order: bug reports with steps that repeat, fixes with a test, documentation.

## The layout

| Where | What |
|---|---|
| `apps/web` | The editor: a Next.js app (TypeScript, React). Timeline engine, renderer, export, AI clients, the interface, the Russian strings (`src/i18n`). |
| the `desktop/` folder (`main.js`, `build.sh`, `native/`, `test/`) | The Electron app around the editor, the native helpers (Swift), the build, and the end-to-end tests that drive the built app. |
| `rust/` | The core parts inherited from OpenCut (WebAssembly). |
| `docs/` | The user documentation, English and Russian. |
| `assets/` | The README's artwork and the scripts that draw it. |

## Run the editor

You need [Bun](https://bun.sh) 1.2 or newer.

```sh
bun install                      # at the repository root
cd apps/web && bun run dev       # the editor in a browser at http://localhost:3000
```

The browser runs the whole editor; the features that need the desktop app (import by link, local models, posting) say so.

## Build the desktop app (macOS, Apple silicon)

As [BUILDING.md](../BUILDING.md) does it:

```sh
bun install                      # the editor's dependencies (workspace root)
cd desktop
npm install                      # Electron for the shell
ARCHES=arm64 ./fetch-vendor.sh   # pinned third-party tools into desktop/vendor/, each checked by sha256
./build.sh                       # → desktop/dist/Gaziyav.app
./make-dmg.sh                    # optional: → a DMG next to it
```

`build.sh` explains its options at the top (Intel build, a smaller build). Nothing from your machine is needed at run time — no Homebrew, no other apps' folders.

## Tests

**Unit and engine tests** run with Bun in `apps/web`:

```sh
cd apps/web
bun test src/timeline     # includes the model-based fuzz of the timeline engine
bun test src/export src/studio src/fal
FUZZ_SEEDS=1500 FUZZ_STEPS=300 bun test src/timeline/__tests__/engine-fuzz.test.ts   # the long run
```

**End-to-end tests** start a hidden copy of the built app with a throwaway profile and drive it over the Chrome DevTools protocol (`test/cdp.mjs`, `test/editor4-lib.mjs`). They never touch your own projects:

```sh
STUDIO_APP_BUNDLE=dist/Gaziyav.app STUDIO_PORT=4021 STUDIO_DEBUG_PORT=10021 STUDIO_TEST_DIR=/tmp/gz-test \
  node test/gaziyav-pro-core.mjs
```

**AI is tested with stand-ins, never with real money.** `test/fake-fal.mjs` is a local server that speaks fal.ai's wire format (queue, storage, pricing, the LLM endpoint) and holds every request to fal's own schemas. The app is started with `STUDIO_FAKE_NET=<its address>`, so every request to the internet goes to the stand-in: nothing is paid and nothing leaves the computer. It can also play failures — no balance, a refused job, a timeout, a dropped connection — so the error paths are tested too. Judging the quality of real lips needs real paid runs; those are the maintainers' call, never a test's.

Rules that keep the suite honest:

- every timeline change keeps the engine invariants (`apps/web/src/timeline/invariants.ts`) after every step, ⌘Z and ⇧⌘Z;
- a bug fix comes with the smallest test that failed before it;
- smoothness is measured in counts (renders, writes, decodes), not in milliseconds on a busy machine.

## Pull requests

- One change per pull request; say what and why in two sentences.
- Run the tests of the folders you touched and the type check.
- New interface text needs its Russian in `apps/web/src/i18n` — written as Russian, not machine-translated.
- Pictures before / after for anything on screen. No API keys or personal files in them.
- By contributing you agree that your contribution is licensed under the MIT licence of this repository.

## Reporting

- Bugs and ideas: [the issue forms](https://github.com/gamidaliev03/gaziyav/issues/new/choose).
- Security problems: privately, see [SECURITY.md](SECURITY.md).

---

## По-русски

Спасибо, что хотите помочь. Сейчас ценнее всего, по порядку: ошибки с повторимыми шагами, исправления с тестом, документация.

- **Запустить редактор:** нужен [Bun](https://bun.sh) 1.2+; `bun install` в корне, затем `cd apps/web && bun run dev` — редактор на http://localhost:3000.
- **Собрать приложение для Mac:** как в [BUILDING.md](../BUILDING.md): `bun install`, затем в `desktop/` — `npm install`, `ARCHES=arm64 ./fetch-vendor.sh`, `./build.sh` → `desktop/dist/Gaziyav.app` (и по желанию `./make-dmg.sh`).
- **Тесты:** модульные и тесты движка — `bun test` в `apps/web`; сквозные — `node test/<тест>.mjs` в папке оболочки с `STUDIO_APP_BUNDLE`, `STUDIO_PORT`, `STUDIO_DEBUG_PORT`, `STUDIO_TEST_DIR` (скрытая копия приложения с одноразовым профилем, ваши проекты не трогаются).
- **ИИ тестируется только на подставном сервере** `test/fake-fal.mjs`: он говорит на протоколе fal.ai и проверяет запросы по схемам fal; приложение запускается с `STUDIO_FAKE_NET`, и весь интернет уходит в подставку — ничего не оплачивается и не покидает компьютер. Качество настоящих губ оценивают только живые платные прогоны, и решают о них сопровождающие, а не тесты.
- **Пулл-реквест:** одно изменение, «что и зачем» в двух предложениях, тесты затронутых папок и проверка типов, русский для новых строк (по-русски, не машинным переводом), картинки до / после. Вклад лицензируется по MIT, как и весь репозиторий.

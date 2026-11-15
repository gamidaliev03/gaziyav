# Contributing to Gaziyav

**English** · [Русский](#по-русски)

Thanks for helping. What helps most right now, in order: bug reports with steps that reproduce the bug, fixes with a test, documentation.

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

The whole editor runs in the browser. Features that need the Mac app (import by link, local models, posting) say so.

## Build the Mac app (Apple silicon)

The same steps as in [BUILDING.md](../BUILDING.md):

```sh
bun install                      # the editor's dependencies (workspace root)
cd desktop
npm install                      # Electron for the shell
ARCHES=arm64 ./fetch-vendor.sh   # pinned third-party tools into desktop/vendor/, each checked by sha256
./build.sh                       # → desktop/dist/Gaziyav.app
./make-dmg.sh                    # optional: → a DMG next to it
```

`build.sh` lists its options at the top (an Intel build, a smaller build). The built app needs nothing else from your machine: no Homebrew, no other apps' folders.

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

**AI is tested with stand-ins, never with real money.** `test/fake-fal.mjs` is a local server that speaks fal.ai's wire format (queue, storage, pricing, the LLM endpoint) and checks every request against fal's own schemas. The app is started with `STUDIO_FAKE_NET=<its address>`, so every request to the internet goes to the stand-in: nothing is paid and nothing leaves the computer. The stand-in can also simulate failures (no balance, a refused job, a timeout, a dropped connection), so the error paths are tested too. Lipsync quality can only be judged on real paid runs; the maintainers decide when to make them, never a test.

Test rules:

- every timeline change keeps the engine invariants (`apps/web/src/timeline/invariants.ts`) after every step, ⌘Z and ⇧⌘Z;
- a bug fix comes with the smallest test that failed before it;
- smoothness is measured in counts (renders, writes, decodes), not in milliseconds on a busy machine.

## Pull requests

- One change per pull request. Say what and why in two sentences.
- Run the tests of the folders you touched and the type check.
- New interface text needs a Russian version in `apps/web/src/i18n`, written in natural Russian, not machine-translated.
- Add before / after screenshots for any change on screen, with no API keys or personal files in them.
- By contributing you agree that your contribution is licensed under the MIT licence of this repository.

## Reporting

- Bugs and ideas: [the issue forms](https://github.com/gamidaliev03/gaziyav/issues/new/choose).
- Security problems: privately, see [SECURITY.md](SECURITY.md).

---

## По-русски

Спасибо за помощь. Сейчас нужнее всего, по порядку: сообщения об ошибках с шагами, по которым ошибка повторяется, исправления с тестом, документация.

- **Запустить редактор:** нужен [Bun](https://bun.sh) 1.2 или новее; `bun install` в корне, затем `cd apps/web && bun run dev` — редактор откроется на http://localhost:3000.
- **Собрать приложение для Mac:** как в [BUILDING.md](../BUILDING.md): `bun install`, затем в `desktop/` — `npm install`, `ARCHES=arm64 ./fetch-vendor.sh`, `./build.sh` → `desktop/dist/Gaziyav.app` (и по желанию `./make-dmg.sh`).
- **Тесты:** модульные и тесты движка — `bun test` в `apps/web`; сквозные — `node test/<тест>.mjs` в папке оболочки с `STUDIO_APP_BUNDLE`, `STUDIO_PORT`, `STUDIO_DEBUG_PORT`, `STUDIO_TEST_DIR`. Они запускают скрытую копию приложения с одноразовым профилем и ваши проекты не трогают.
- **ИИ тестируется только на подставном сервере** `test/fake-fal.mjs`. Он работает по протоколу fal.ai и проверяет запросы по схемам fal. Приложение запускается с `STUDIO_FAKE_NET`, и все запросы в интернет идут на подставной сервер: ничего не оплачивается и не покидает компьютер. Качество липсинка можно оценить только на настоящих платных запусках; когда их делать, решают сопровождающие, а не тесты.
- **Запрос на слияние (pull request):** одно изменение; «что и зачем» в двух предложениях; тесты затронутых папок и проверка типов; русский текст для новых строк, написанный по-русски, а не машинным переводом; скриншоты до и после. Вклад лицензируется по MIT, как и весь репозиторий.

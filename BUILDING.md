# Building Gaziyav

Gaziyav has two parts: the editor (`apps/web`, a Next.js app built on OpenCut) and the desktop shell (`desktop/`, an
Electron app that runs the editor's server on `127.0.0.1` and adds the Mac-only features). `desktop/build.sh` puts
both into one `Gaziyav.app`.

| platform | status |
|---|---|
| macOS 14+ on Apple silicon (arm64) | supported; releases are built this way |
| macOS 14+ on Intel (x64) | builds (`ARCH=x64`); the on-device AI that needs Apple silicon is off |

## Prerequisites (Mac)

- macOS 14 or later, ~15 GB of free disk space.
- Xcode Command Line Tools: `xcode-select --install` (for `swiftc`, `codesign`, `install_name_tool`).
- [Bun](https://bun.sh) 1.2 or later and [Node.js](https://nodejs.org) 22 or later (with `npm`).
- `curl`, `unzip`, `rsync`, `python3` (all part of macOS).
- Only to rebuild the WebAssembly engine (`rust/`): Rust and `wasm-pack` (`scripts/build-wasm.sh`). A built copy is
  in `rust/wasm/pkg`, so you can skip this.

## Build the Mac app

```sh
git clone <this repository> gaziyav && cd gaziyav
bun install                      # the editor's dependencies (workspace root)
cd desktop
npm install                      # Electron for the shell
ARCHES=arm64 ./fetch-vendor.sh   # pinned third-party tools into desktop/vendor/ (ffmpeg, yt-dlp, uv, whisper.cpp,
                                 # Remotion's renderer and bundler, Chrome headless shell) — each checked by sha256
./build.sh                       # → desktop/dist/Gaziyav.app
./make-dmg.sh                    # optional: → a DMG next to it
```

`build.sh` builds the editor (`bun run build` in `apps/web`), copies the shell and the tools, compiles the Apple
helpers in `desktop/native/*.swift`, and signs the app ad hoc. A downloaded copy then shows «Apple could not
verify…»: right-click → Open.

Options:

- `SKIP_WEB=1` reuses the last editor build;
- `ARCH=x64` builds for Intel;
- `SLIM=1` makes the app smaller;
- `VERSION=1.2.3` sets the version.

### Content in a build from this tree

`PUBLIC_RELEASE` is on by default here: the build leaves out every piece of content whose licence does not allow
redistribution (`desktop/content-licenses.mjs`). The app lists the source and licence of everything it carries in
`Contents/Resources/LICENSES`.

Not in the tree:

- **The music and sound-effect library.** The catalog is empty unless you point `MEDIA_CATALOG` at a folder with
  `Music/library.json` and `Sound Effects/library.json`. Rows with a `url` download from their publisher on first use.
- **Your own graphics library.** `GRAPHICS_LIBRARY=<folder with Graphics/>` adds it to your build; `PUBLIC_RELEASE`
  drops it again.
- **Ready-made voice samples** for the voice picker (`desktop/native/voices/` is not in the tree).
- **AI keys.** None are included. The app asks for your own fal.ai / kie.ai / ArgoLink / Anthropic key in Settings and
  keeps it in the macOS Keychain.

### Run it

```sh
open desktop/dist/Gaziyav.app
```

Projects are stored in the app's browser storage and in `~/Library/Application Support/Gaziyav`.

### Test it

The smoke test starts a hidden copy of the built app in test mode: its own data folder and port, Chromium's fake
camera and microphone, never your projects. It makes a project, imports a clip and a picture that it generates with
the app's own ffmpeg, places and plays the clip, and checks that the page has no errors:

```sh
cd desktop
STUDIO_APP_BUNDLE="$PWD/dist/Gaziyav.app" node test/smoke.mjs
```

`STUDIO_DEBUG_PORT` / `STUDIO_PORT` / `STUDIO_TEST_DIR` let several copies run side by side.

`desktop/test/fake-fal.mjs`, `fake-kie.mjs`, `fake-argo.mjs` and `fake-late.mjs` stand in for the paid AI and posting
services: same wire format, nothing is paid or posted. A test starts the app with
`STUDIO_FAKE_NET=<the stand-in's address>`.

The editor's unit tests: `cd apps/web && bun test src`.

## Work on the editor alone

```sh
cd apps/web && bun run dev       # the editor in a browser at http://localhost:3000
```

The desktop-only parts (export to disk, on-device AI, the Apple helpers, the Claude connector) need the Mac app.

## Other systems

There is no Windows or Linux build. On those systems, use the browser edition of Gaziyav.

## Layout

| path | what |
|---|---|
| `apps/web/` | the editor (Next.js): `src/` the app, `mcp/` the Claude connector, `public/` its bundled content |
| `desktop/` | the shell: `main.js`, `preload.js`, `modules/`, `native/` (Swift and Python helpers), build scripts, `test/` |
| `rust/` | the WebAssembly effects / compositor engine (from OpenCut), built copy in `rust/wasm/pkg` |

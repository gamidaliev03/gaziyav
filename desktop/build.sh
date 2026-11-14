#!/bin/zsh
# Builds "Gaziyav.app": the editor's production server + this Electron shell + every tool it needs
# (ffmpeg/ffprobe, whisper-cli, uv, the Apple helpers, the AI-layer renderer; yt-dlp and its headless browser come on first use).
# Nothing on the build machine is needed at run time: no Homebrew, no ~/.local, no other apps' folders.
# Usage: ./build.sh                 (rebuilds the web app too; arm64)
#        SKIP_WEB=1 ./build.sh      (reuse the last web build)
#        ARCH=x64 ./build.sh        (Intel build: Electron x64, x64 tools; on-device AI that needs Apple silicon is off)
#        SLIM=1 ./build.sh          (the same content, smaller: library audio as AAC 160k, sticker PNGs as lossless WebP,
#                                    Lottie stickers gzipped, no build leftovers in the server, symbols stripped; see SLIM below)
# Third-party tools come from ./vendor (run ./fetch-vendor.sh once; it pins versions and checksums).
set -euo pipefail
HERE="${0:A:h}"
# WEB_SRC / OUT_DIR let each developer build their own branch into their own folder.
WEB="${WEB_SRC:-$HERE/../apps/web}"
ARCH="${ARCH:-arm64}"
OUT="${OUT_DIR:-$HERE/dist}"
NAME="Gaziyav"
BUNDLE_ID="com.gaziyav.app"
# name, and Resources/edition, which gives it a data folder of its own (main.js) — it never replaces the owner's
# Gaziyav nor opens his data on a Mac that has both. The executable and the helpers keep the name Gaziyav.
SHOWN="$NAME"
# Its icon is the family under Dagestan's mountains (brand/family, drawn by make-brand.swift); ICON_FILE= overrides.
ICON="$HERE/icon.icns"
ICON="${ICON_FILE:-$ICON}"
VERSION="${VERSION:-1.0}"
APP="$OUT/$NAME.app"
V="$HERE/vendor/$ARCH"
export PATH="$HOME/.bun/bin:$HOME/.local/node/bin:$PATH"

case $ARCH in
	arm64) SWIFT_TARGET=arm64-apple-macos13.0; ELECTRON_APP="$HERE/node_modules/electron/dist/Electron.app" ;;
	x64) SWIFT_TARGET=x86_64-apple-macos13.0; ELECTRON_APP="$V/electron/Electron.app" ;;
	*) echo "ARCH must be arm64 or x64" >&2; exit 1 ;;
esac
[[ -x "$V/bin/ffmpeg" && -d "$V/remotion/node_modules" ]] || "$HERE/fetch-vendor.sh"

if [[ -z "${SKIP_WEB:-}" ]]; then
	# PUBLIC_RELEASE=1: the build for GitHub (code can leave testOnly content out: process.env.NEXT_PUBLIC_PUBLIC_RELEASE)
	(cd "$WEB" && NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_PUBLIC_RELEASE="${PUBLIC_RELEASE-1}" bun run build)
fi

rm -rf "$APP"
mkdir -p "$OUT"
ditto "$ELECTRON_APP" "$APP"
RES="$APP/Contents/Resources"
rm -f "$RES/default_app.asar"
# English-only app: drop Electron's other localizations so macOS panels (Open/Save), the app menu's
# system items and Chromium's strings stay English on a Russian (or any) system language.
for l in "$RES"/*.lproj(N); do
	[[ "${l:t}" == "en.lproj" ]] || rm -rf "$l"
done

# ---------- Tools in Resources/bin ----------
mkdir -p "$RES/bin" "$RES/LICENSES"
# uv's Python setup calls install_name_tool: without this a Mac with no developer tools asks to install them
mkdir -p "$RES/bin/shims"; printf '#!/bin/sh\nexit 0\n' > "$RES/bin/shims/install_name_tool"; chmod +x "$RES/bin/shims/install_name_tool"
# Apple helpers (Vision face check, voice isolation, lip landmarks + the AI-generated plate).
swiftc -O -target $SWIFT_TARGET -o "$RES/bin/facecheck" "$HERE/native/facecheck.swift"
swiftc -O -target $SWIFT_TARGET -o "$RES/bin/voiceisolate" "$HERE/native/voiceisolate.swift"
swiftc -O -target $SWIFT_TARGET -o "$RES/bin/lipmarks" "$HERE/native/lipmarks.swift"
# Motion: tracking (Vision), reverse and optical-flow slow motion (VideoToolbox VTFrameProcessor).
swiftc -O -target $SWIFT_TARGET -o "$RES/bin/motion" "$HERE/native/motion.swift"
# macOS memory pressure → the editor drops its caches before the system has to kill anything (event-driven, no CPU).
swiftc -O -target $SWIFT_TARGET -o "$RES/bin/mempressure" "$HERE/native/mempressure.swift"
# macOS thermal state → the models pause while the Mac is hot (serious / critical) and continue when it cools (event-driven).
swiftc -O -target $SWIFT_TARGET -o "$RES/bin/thermal" "$HERE/native/thermal.swift"
# The Force Touch trackpad's tap when a clip snaps, a guide aligns or a trim reaches its end (stdin-driven, no CPU idle).
swiftc -O -target $SWIFT_TARGET -o "$RES/bin/haptic" "$HERE/native/haptic.swift"
# Effects → AI (Remove Background / Enhance / Denoise / Upscale): Vision + Core Image + MetalFX, VideoToolbox encode.
swiftc -O -target $SWIFT_TARGET -o "$RES/bin/neuralfx" "$HERE/native/neuralfx.swift"
# Claude's eye for beauty (production/server): Apple Vision aesthetics (macOS 15+), faces and eyes, horizon, saliency, image statistics.
swiftc -O -target $SWIFT_TARGET -o "$RES/bin/framejudge" "$HERE/native/framejudge.swift"
# Gaziyav: lipsync, voice and face swap run on fal.ai — their on-device helpers (local-lipsync.py, local-tts.py) stay out.
# local-faceswap.py stays: Retouch runs on it.
cp "$HERE/native/local-voices.py" "$HERE/native/local-faceswap.py" "$HERE/native/local-cleanup.py" "$HERE/native/local-separate.py" "$HERE/native/local-voicechange.py" "$RES/bin/"
# music (11.11): the beat model's helper and its one-time converter (a part of Separate: ondevice/manifest.ts PARTS)
cp "$HERE/native/local-beats.py" "$HERE/native/local-beats-convert.py" "$RES/bin/"
# The ready-made voices: a short recording of each voice in each style (the voice model speaks from them).
[[ -d "$HERE/native/voices" ]] && ditto "$HERE/native/voices" "$RES/voices"
# ffmpeg/ffprobe (static, GPL), uv (Python installer for On-device AI), whisper-cli.
for t in ffmpeg ffprobe uv whisper-cli; do install -m 755 "$V/bin/$t" "$RES/bin/$t"; done
# owner's own edition is the editor alone and carries neither (80 MB + 3 MB; the browser / VPN tests run on a family build).
# SLIM: their symbol tables are of no use on a user's Mac (crash logs still name the binary and the offset).
if [[ -n "${SLIM:-}" ]]; then for t in ffmpeg ffprobe whisper-cli; do strip "$RES/bin/$t" 2>/dev/null; done; fi
# yt-dlp unpacked (starts in 0.3 s instead of ~9 s); bin/yt-dlp is a link to it, so every caller stays the same.
# ON_DEMAND=1 (the light build, like iCloud Photos): yt-dlp and the headless browser are left out and come the first time
# they are needed (studio/server/components.ts).
if [[ -z "${ON_DEMAND:-}" ]]; then
	[[ -x "$V/yt-dlp/yt-dlp_macos" ]] || { echo "vendor/$ARCH/yt-dlp is missing: run ./fetch-vendor.sh" >&2; exit 1; }
	ditto "$V/yt-dlp" "$RES/yt-dlp"
	ln -s ../yt-dlp/yt-dlp_macos "$RES/bin/yt-dlp"
fi
cp "$V/licenses/"*.txt "$RES/LICENSES/"
# Offline speech recognition: whisper.cpp 1.9.5 built by fetch-vendor.sh for macOS 13+ (the model is downloaded in-app).

# The AI-layer renderer: @remotion/renderer + compositor for this arch + its headless browser (everything but AI models
# stays inside the app; components.ts fetches Chrome only for a build that leaves it out).
if [[ -n "${ON_DEMAND:-}" ]]; then rsync -a --exclude 'chrome-headless-shell*' "$V/remotion/" "$RES/remotion/"; else ditto "$V/remotion" "$RES/remotion"; fi

# ---------- The shell ----------
mkdir -p "$RES/app"
cp "$HERE/main.js" "$HERE/preload.js" "$HERE/package.json" "$RES/app/"
rm -rf "$RES/app/modules" && cp -R "$HERE/modules" "$RES/app/modules"
# app.getVersion() (logs, About, update checks) reads this file: the build's version, not the one in the repo.
/usr/bin/python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["version"]=sys.argv[2]; json.dump(d, open(p,"w"), indent="\t")' "$RES/app/package.json" "$VERSION"

# ---------- The editor server: standalone output plus the static files Next leaves out of it ----------
ditto "$WEB/.next/standalone" "$RES/web"
ditto "$WEB/.next/static" "$RES/web/apps/web/.next/static"
ditto "$WEB/public" "$RES/web/apps/web/public"

# Stickers from the content cloud (tools/make-cloud-content.py): the app keeps each set's catalog, cloud.json, licence
# and its 64 px previews (<set>-preview); the full files come down on first use. EMBED_LIBRARY=1 keeps them inside.
if [[ -z "${EMBED_LIBRARY:-}" ]]; then
	for set in emoji3d noto-animated; do
		d="$RES/web/apps/web/public/stickers/$set"
		[[ -f "$d/cloud.json" ]] && find "$d" -type f ! -name catalog.json ! -name cloud.json ! -name LICENSE.txt -delete
	done
fi
# SLIM, full build only (the light build has no sticker files): content/server/files.ts serves a sticker from inside the
# app first; a PNG may sit there as lossless WebP (the same pixels — checked below, premultiplied, so the colour of fully
# clear pixels does not count), a Lottie JSON gzipped (sent as is with Content-Encoding: gzip). The catalogs stay as
# they are: names, checksums and the light build's downloads do not change.
if [[ -n "${SLIM:-}" && -n "${EMBED_LIBRARY:-}" ]]; then
	FFM="$V/bin/ffmpeg"
	[[ $ARCH == arm64 ]] || FFM="$HERE/vendor/arm64/bin/ffmpeg"
	d="$RES/web/apps/web/public/stickers/emoji3d"
	if [[ -f "$d/cloud.json" ]]; then
		# (no xargs -I: it refuses a path over 255 bytes, and this folder's is longer)
		find "$d" -maxdepth 1 -name '*.png' -print0 | FFM="$FFM" xargs -0 -n 1 -P 6 zsh -c '
			p="$1"; w="${p:r}.webp"
			"$FFM" -nostdin -v error -y -i "$p" -c:v libwebp -lossless 1 -compression_level 6 "$w" || exit 1
			a=$("$FFM" -nostdin -v error -i "$p" -vf format=rgba,premultiply=inplace=1 -f md5 -)
			b=$("$FFM" -nostdin -v error -i "$w" -vf format=rgba,premultiply=inplace=1 -f md5 -)
			if [[ -n "$a" && "$a" == "$b" && $(stat -f %z "$w") -lt $(stat -f %z "$p") ]]; then rm "$p"; else rm -f "$w"; fi
		' _
		echo "SLIM stickers/emoji3d: $(find "$d" -name '*.webp' | wc -l | tr -d ' ') as WebP, $(find "$d" -name '*.png' | wc -l | tr -d ' ') PNG kept"
	fi
	d="$RES/web/apps/web/public/stickers/noto-animated"
	[[ -f "$d/cloud.json" ]] && find "$d" -maxdepth 1 -name '*.json' ! -name catalog.json ! -name cloud.json -print0 | xargs -0 -P 6 gzip -9 -n
fi
# SLIM: what the server never reads at run time — the sources Next's tracer pulled in, the TypeScript compiler (the
# standalone server reads its config from required-server-files.json), the type-check cache. Source maps stay: the AI
# layers' renderer (Remotion) opens public/montage-bundle/bundle.js.map, and without it every such export failed.
if [[ -n "${SLIM:-}" ]]; then
	rm -rf "$RES/web/apps/web/src" "$RES/web/apps/web/tsconfig.tsbuildinfo" "$RES/web/node_modules/typescript" "$RES/web/node_modules/.bun/"typescript@*(N)
fi
# Claude connection: the MCP server, its launcher and the editing skill (branches that have apps/web/mcp).
[[ -d "$WEB/mcp" ]] && ditto "$WEB/mcp" "$RES/mcp"
rm -f "$RES/web/apps/web/"(.env*)(N)
if [[ $ARCH == x64 ]]; then
	# The image library of the web server, for Intel (node resolves it from web/node_modules).
	mkdir -p "$RES/web/node_modules/@img"
	ditto "$V/sharp/node_modules/@img" "$RES/web/node_modules/@img"
	find "$RES/web/node_modules" -path "*darwin-arm64*" -prune -exec rm -rf {} + 2>/dev/null || true
fi

# ---------- Name, id, executable, helpers ----------
PL="$APP/Contents/Info.plist"
pb() { /usr/libexec/PlistBuddy -c "$1" "$2" >/dev/null 2>&1 || true; }
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/$NAME"
pb "Set :CFBundleExecutable $NAME" "$PL"
pb "Set :CFBundleName $NAME" "$PL"
pb "Delete :CFBundleDisplayName" "$PL"; pb "Add :CFBundleDisplayName string $NAME" "$PL"
# CFBundleName stays «Gaziyav»: Electron finds its helpers by it («Gaziyav Helper.app»; another name → «Unable to find helper app»)
pb "Set :CFBundleIdentifier $BUNDLE_ID" "$PL"
pb "Set :CFBundleShortVersionString $VERSION" "$PL"
pb "Set :CFBundleVersion $VERSION" "$PL"
pb "Delete :NSHumanReadableCopyright" "$PL"; pb "Add :NSHumanReadableCopyright string © Gaziyav" "$PL"
pb "Delete :CFBundleDevelopmentRegion" "$PL"; pb "Add :CFBundleDevelopmentRegion string en" "$PL"
pb "Delete :CFBundleLocalizations" "$PL"; pb "Add :CFBundleLocalizations array" "$PL"; pb "Add :CFBundleLocalizations:0 string en" "$PL"
pb "Delete :ElectronAsarIntegrity" "$PL"
# macOS 14 or later: what Apple still supports, what the on-device AI needs, and the oldest system Remotion's FFmpeg
# links against (see below). Every Apple silicon Mac (M1 and later) runs it.
pb "Set :LSMinimumSystemVersion 14.0" "$PL"
pb "Set :LSApplicationCategoryType public.app-category.video" "$PL"
pb "Set :NSMicrophoneUsageDescription Gaziyav records voice-overs with your microphone." "$PL"
pb "Set :NSCameraUsageDescription Gaziyav records video with your camera." "$PL"
pb "Set :NSAudioCaptureUsageDescription Gaziyav records the sound of your Mac." "$PL"
# Helper apps carry the app's name (Activity Monitor shows them); Electron finds them by CFBundleName.
FW="$APP/Contents/Frameworks"
for h in "$FW"/Electron\ Helper*.app(N); do
	base="${h:t:r}"                       # "Electron Helper (GPU)"
	new="${base/Electron/$NAME}"          # "Gaziyav Helper (GPU)"
	suffix="${${base#Electron Helper}// /}"; suffix="${${suffix//[()]/}:l}"
	mv "$h/Contents/MacOS/$base" "$h/Contents/MacOS/$new"
	pb "Set :CFBundleExecutable $new" "$h/Contents/Info.plist"
	pb "Set :CFBundleName $new" "$h/Contents/Info.plist"
	pb "Delete :CFBundleDisplayName" "$h/Contents/Info.plist"; pb "Add :CFBundleDisplayName string $new" "$h/Contents/Info.plist"
	pb "Set :CFBundleIdentifier $BUNDLE_ID.helper${suffix:+.$suffix}" "$h/Contents/Info.plist"
	mv "$h" "$FW/$new.app"
done
if [[ -f "$ICON" ]]; then
  cp "$ICON" "$RES/electron.icns"
fi

# English only (main.js forces --lang=en-US): Chromium's 220 other UI languages are ~48 MB nobody loads.
for d in "$FW/Electron Framework.framework/Versions/A/Resources/"*.lproj(N); do
	[[ "${d:t}" == en.lproj ]] || rm -rf "$d"
done

# Remotion's FFmpeg (ffmpeg, ffprobe, libav*) comes built with macOS 15 as its minimum, though the newest system
# symbols it links are macOS 14 (capture-device types in libavdevice; checked with nm -m -u): marked 14.0 so it loads
# on macOS 14 too. Signed again below.
for f in "$RES"/remotion/node_modules/@remotion/compositor-darwin-*/{ffmpeg,ffprobe,*.dylib}(N); do
	minos=$(otool -l "$f" | awk '/LC_BUILD_VERSION/{b=1} b&&/minos/{print $2; exit}')
	sdk=$(otool -l "$f" | awk '/LC_BUILD_VERSION/{b=1} b&&/sdk/{print $2; exit}')
	if [[ "${minos%%.*}" -gt 14 ]]; then
		vtool -set-build-version macos 14.0 "$sdk" -replace -output "$f.vt" "$f" && chmod +x "$f.vt" && mv "$f.vt" "$f"
	fi
done

# Keychain (studio/server/agent-keys.ts), and make-dmg.sh refuses an image that holds any key.

# The ready-made library every user gets: Lottie graphics and fonts inside the app (Kadr's, cloned in); music and
# sound effects as a catalog only (names, lengths, preview waves, checksums: bun scripts/media-catalog.ts) — each file
# downloads the first time it is played or used and is cached (library/server/remote.ts). The DMG is ~930 MB smaller.
KL="${GRAPHICS_LIBRARY:-/nonexistent}"
# Music and sound effects: Gaziyav's own library (tools/make-library.py) — the files are inside the app, each with its
# author, source and licence (Kevin MacLeod CC BY 4.0, OpenGameArt CC0, Gaziyav's own CC0 sounds); LIBRARY.md lists them.
CAT="${MEDIA_CATALOG:-$HERE/vendor/library-pc}"
if [[ ! -f "$CAT/Music/library.json" || ! -f "$CAT/Sound Effects/library.json" ]]; then
	echo "note: no music / sound catalog at $CAT (MEDIA_CATALOG=<a folder with Music/ and Sound Effects/library.json>) — the library is empty"
	CAT="$(mktemp -d)"; for part in Music "Sound Effects"; do mkdir -p "$CAT/$part"; echo "[]" > "$CAT/$part/library.json"; done
fi
# SLIM, full build: the library's MP3/WAV as AAC 160k (compress-library.sh; made once per catalog, kept in
# vendor/library-slim/<catalog hash>). The light build keeps the catalog as it is: its rows download the original files.
if [[ -n "${SLIM:-}" && -n "${EMBED_LIBRARY:-}" ]]; then
	h=$(cat "$CAT/Music/library.json" "$CAT/Sound Effects/library.json" | shasum -a 256 | cut -c1-12)
	CAT=$(SLIM=1 "$HERE/compress-library.sh" "$CAT" "$HERE/vendor/library-slim/$h" | tail -1)
fi
mkdir -p "$RES/library"
# Fonts: a branch with src/fonts/remote-fonts.json carries only its base set and downloads the rest on first use; an
# older branch still gets the whole font library.
parts=(Graphics)
[[ -f "$WEB/src/fonts/remote-fonts.json" ]] || parts+=(Fonts)
for part in "${parts[@]}"; do
	[[ -d "$KL/$part" ]] && cp -cR "$KL/$part" "$RES/library/"
done
# Only the catalogs (names, lengths, waves, checksums): each file comes from the content cloud the first time it is used
# (content/server/cloud.ts — the upload folder ~/gaziyav-content, then our Hugging Face dataset, then the publisher).
# EMBED_LIBRARY=1 puts the files in again (a build for a Mac without the internet).
for part in Music "Sound Effects"; do
	mkdir -p "$RES/library/$part"
	if [[ -n "${EMBED_LIBRARY:-}" ]]; then cp -cR "$CAT/$part/" "$RES/library/$part/"; else cp "$CAT/$part/library.json" "$RES/library/$part/"; fi
	find "$RES/library/$part" -name '.*' -delete
done
[[ -f "$CAT/LIBRARY.md" ]] && cp "$CAT/LIBRARY.md" "$RES/LICENSES/LIBRARY.md"
chmod -R u+w "$RES/library"

# ---------- Content licences ----------
# LICENSES/CONTENT.md + content.json: every piece of content with its source and licence; testOnly = may stay on this
# Mac only (non-commercial, «no redistribution», the user's own library). The personal build (default) carries it all;
# PUBLIC_RELEASE=1, the build for GitHub, takes every testOnly piece out first (content-licenses.mjs, content-sources.json).
NODE=$(command -v node || command -v bun)
if [[ -n "${PUBLIC_RELEASE-1}" ]]; then "$NODE" "$HERE/content-licenses.mjs" strip "$RES"; fi
"$NODE" "$HERE/content-licenses.mjs" collect "$RES" "$WEB"

# The «with models» build: every model's files, the Python builds and the wheels, inside the app (APFS clones of
# SEED_DIR, made by make-seed.mjs). The app installs them by itself on the first launch, without the internet.
if [[ -n "${SEED_DIR:-}" ]]; then
	[[ -f "$SEED_DIR/seed.json" ]] || { echo "SEED_DIR has no seed.json" >&2; exit 1; }
	cp -cR "$SEED_DIR" "$RES/seed"
fi

# ---------- No trace of the Mac that built it (a friend gets this DMG) ----------
# The build folder Next writes into its server files and whisper.cpp compiles into its messages: replaced by filler of
# the same length (a binary keeps every offset), the home folder's name too. make-dmg.sh checks the result.
/usr/bin/python3 - "$APP" "${HERE:h}" "$HOME" <<'PY'
import os, sys
app, work, home = sys.argv[1], sys.argv[2].encode(), sys.argv[3].encode()
name = home.rsplit(b"/", 1)[-1]
swaps = [(work, b"/gaziyav" + b"/" * (len(work) - len(b"/gaziyav"))), (home + b"/", home[: -len(name)] + b"u" * len(name) + b"/")]
for root, _, files in os.walk(app):
    for f in files:
        p = os.path.join(root, f)
        if os.path.islink(p):
            continue
        with open(p, "rb") as fh:
            data = fh.read()
        if home not in data and work not in data:
            continue
        for old, new in swaps:
            data = data.replace(old, new)
        with open(p, "wb") as fh:
            fh.write(data)
        print("scrubbed", os.path.relpath(p, app))
PY

# ---------- Electron fuses (before the signature) ----------
# No NODE_OPTIONS and no --inspect/--inspect-brk: either let any script of the user run its own JavaScript inside
# Gaziyav — as Gaziyav, with its Keychain items and, while it is unlocked, its work space. RunAsNode stays (the app's
# own tools run its Node: the AI layers' renderer, yt-dlp's challenge solver).
python3 - "$FW/Electron Framework.framework/Versions/A/Electron Framework" <<'PY'
import sys
path = sys.argv[1]
data = bytearray(open(path, "rb").read())
sentinel = b"dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX"
at = data.find(sentinel)
assert at >= 0 and data.count(sentinel) == 1, "Electron fuse wire not found"
wire = at + len(sentinel) + 2
# v1 wire: 0 RunAsNode, 1 CookieEncryption, 2 NodeOptions, 3 NodeCliInspect, …
assert data[at + len(sentinel)] == 1 and data[at + len(sentinel) + 1] >= 4, "unknown fuse wire"
for i in (2, 3):
    data[wire + i] = ord("0")
open(path, "wb").write(data)
print("fuses:", data[wire:wire + data[at + len(sentinel) + 1]].decode())
PY

# signature, so the bundle is signed once (signing it again afterwards took four minutes per build).
[[ -n "${NO_SPACE_MARK:-}" ]] && touch "$RES/app/no-space"
# ---------- Ad-hoc signature, inside out ----------
# A valid signature is what makes a downloaded copy show "Apple could not verify…" (Open Anyway works)
# instead of "is damaged". No extended attributes may sit in the bundle when it is sealed.
# Dangling links that Next's standalone output leaves behind can't be sealed: drop them.
find "$APP" -type l ! -exec test -e {} \; -delete
xattr -cr "$APP"
# A stable identity keeps macOS's Keychain «Always Allow» across updates: an ad-hoc signature changes with every build,
# so every update asked for the keys again. The owner makes it once (Keychain Access → Certificate Assistant → Create a
# Certificate… → name «Gaziyav Dev», Identity Type «Self-Signed Root», Certificate Type «Code Signing»); without it the
# build is signed ad hoc as before. GAZIYAV_SIGN_ID names another identity.
SIGN_ID="${GAZIYAV_SIGN_ID:-$(security find-identity -p codesigning 2>/dev/null | grep -q '"Gaziyav Dev"' && echo "Gaziyav Dev" || printf '%s' -)}"
sign() { codesign --force --sign "$SIGN_ID" --timestamp=none "$@"; }
# Every loose binary in Resources (tools, renderer, headless browser, native modules of the web server).
binDirs=("$RES/remotion" "$RES/web")
[[ -d "$RES/yt-dlp" ]] && binDirs+=("$RES/yt-dlp")
{
	find "$RES/bin" -type f -perm +111
	find "${binDirs[@]}" -type f \( -name "*.node" -o -name "*.dylib" -o -perm +111 \) -print0 | xargs -0 file | grep "Mach-O" | cut -d: -f1
} | sort -u | while read -r f; do sign "$f"; done
# Frameworks: their libraries and helpers first, then the frameworks.
for f in "$FW"/*.framework/Versions/A/{Libraries,Helpers}/*(N); do
	[[ -f "$f" && "$f" != *.json ]] && sign "$f"
done
for f in "$FW"/*.framework(N); do sign "$f"; done
for f in "$FW"/*.app(N); do sign --options runtime --entitlements "$HERE/entitlements.plist" "$f"; done
sign --options runtime --entitlements "$HERE/entitlements.plist" "$APP"
codesign --verify --deep --strict "$APP"
echo "Built: $APP ($ARCH, $(du -sh "$APP" | cut -f1))"

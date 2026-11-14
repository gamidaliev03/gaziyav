#!/bin/zsh
# Downloads the pinned third-party tools that ship inside the app into desktop/vendor/<arch> (build.sh copies them).
# Every file is checked against its sha256; a changed upstream file stops the build instead of shipping something unknown.
#   ./fetch-vendor.sh            → arm64 and x64
#   ARCHES=arm64 ./fetch-vendor.sh
# Contents (all redistributable; licences go to Resources/LICENSES):
#   ffmpeg + ffprobe   static GPL builds (osxexperts.net), no nonfree parts
#   yt-dlp             macOS build, unpacked (Unlicense): the one-file build unpacks itself on every run (~9 s)
#   uv                 Astral's Python installer (MIT/Apache-2.0), used by the in-app model manager
#   remotion           @remotion/renderer + compositor for the arch (Remotion licence) + Chrome headless shell (BSD)
set -euo pipefail
HERE="${0:A:h}"
V="$HERE/vendor"
ARCHES=(${=ARCHES:-arm64 x64})
NPM_BIN="${NPM_BIN:-$HOME/.local/node/bin}"
export PATH="$NPM_BIN:$PATH"
REMOTION=4.0.536
CHROME=157.0.8080.0
YTDLP=2026.08.19
UV=0.13.1

fetch() { # url dest sha256
	local url=$1 dest=$2 sum=$3
	if [[ -f "$dest" ]] && [[ "$(shasum -a 256 "$dest" | cut -d' ' -f1)" == "$sum" ]]; then return; fi
	mkdir -p "${dest:h}"
	echo "↓ ${url}"
	curl -fL --retry 3 -o "$dest.part" "$url"
	local got="$(shasum -a 256 "$dest.part" | cut -d' ' -f1)"
	if [[ "$got" != "$sum" ]]; then
		echo "checksum mismatch for $url: $got (expected $sum)" >&2
		rm -f "$dest.part"
		exit 1
	fi
	mv "$dest.part" "$dest"
}

D="$V/downloads"
mkdir -p "$D"

# yt-dlp: the unpacked (onedir) universal build — it starts in 0.3 s, the one-file build in ~9 s (it unpacks itself
# into a new temp folder and macOS checks every unpacked library, on every search, link and download).
fetch "https://github.com/yt-dlp/yt-dlp/releases/download/$YTDLP/yt-dlp_macos.zip" "$D/yt-dlp_macos-$YTDLP.zip" 07e54b0865303c864006925913bce2604f8ee8cc6f18699bac9c309f9328a6d8

for ARCH in $ARCHES; do
	[[ "$ARCH" == none ]] && continue # ARCHES=none: only the browser's filter lists below
	OUT="$V/$ARCH"
	mkdir -p "$OUT/bin" "$OUT/licenses"
	case $ARCH in
		arm64)
			fetch https://www.osxexperts.net/ffmpeg9arm.zip "$D/ffmpeg9arm.zip" d0c06c5c68ce48af3143b262f7a9118a7c9f67de1e237fcc24ffb14df9c67af9
			fetch https://www.osxexperts.net/ffprobe9arm.zip "$D/ffprobe9arm.zip" 0c94fbdd8917022f28115eca512196cf4648732bc9e5db9ec8896c7e519d02aa
			FF="$D/ffmpeg9arm.zip"; FP="$D/ffprobe9arm.zip"; FFV="9.0"
			fetch "https://github.com/astral-sh/uv/releases/download/$UV/uv-aarch64-apple-darwin.tar.gz" "$D/uv-$UV-arm64.tgz" cfe454573412ff7380d15fc7dae5997ab53ffce72fce0a78e91ddbc84001acd2
			CHURL="https://remotion.media/chromium-headless-shell-mac-arm64-$CHROME.zip?clear"; CHSUM=""; CHPLAT=mac-arm64; NPMCPU=arm64
			;;
		x64)
			fetch https://www.osxexperts.net/ffmpeg80intel.zip "$D/ffmpeg80intel.zip" 2d24d22db78c87f394a5822867acd5c5dc5e762cd261a44bd26923f3a5af3e07
			fetch https://www.osxexperts.net/ffprobe80intel.zip "$D/ffprobe80intel.zip" 0b6576104a95c1b39d4939e2df86f8f7cf1d55287ff57da48777d94605d12feb
			FF="$D/ffmpeg80intel.zip"; FP="$D/ffprobe80intel.zip"; FFV="8.0"
			fetch "https://github.com/astral-sh/uv/releases/download/$UV/uv-x86_64-apple-darwin.tar.gz" "$D/uv-$UV-x64.tgz" bb7b805bdcf3d0bc8c74ceb94569e6b3e8aa35bd492acdbb9d46bf46d9d4ff6b
			CHURL="https://storage.googleapis.com/chrome-for-testing-public/$CHROME/mac-x64/chrome-headless-shell-mac-x64.zip"; CHSUM=""; CHPLAT=mac-x64; NPMCPU=x64
			;;
		*) echo "unknown arch $ARCH" >&2; exit 1 ;;
	esac

	# ffmpeg / ffprobe
	T="$(mktemp -d)"
	unzip -q -o "$FF" -d "$T"; unzip -q -o "$FP" -d "$T"
	install -m 755 "$T/ffmpeg" "$OUT/bin/ffmpeg"
	install -m 755 "$T/ffprobe" "$OUT/bin/ffprobe"
	rm -rf "$T"
	cat > "$OUT/licenses/ffmpeg.txt" <<EOF
FFmpeg $FFV (static build by osxexperts.net), licensed under the GNU General Public License v2 or later.
It runs as a separate program; the app calls it on the command line.
Source code: https://ffmpeg.org/releases/ (version $FFV) — build configuration: run \`ffmpeg -buildconf\` from Resources/bin.
EOF

	# yt-dlp: unpacked to vendor/<arch>/yt-dlp, thinned to the arch; the zip stores the framework's links as copies,
	# so they become links again (3 × 15 MB less).
	rm -rf "$OUT/yt-dlp" "$OUT/bin/yt-dlp"
	unzip -q -o "$D/yt-dlp_macos-$YTDLP.zip" -d "$OUT/yt-dlp"
	(
		cd "$OUT/yt-dlp/_internal"
		F=Python.framework
		PYV="$(ls $F/Versions | grep -v Current | head -1)"
		rm -rf $F/Versions/Current $F/Python $F/Resources Python
		ln -s "$PYV" $F/Versions/Current
		ln -s Versions/Current/Python $F/Python
		ln -s Versions/Current/Resources $F/Resources
		ln -s "$F/Versions/$PYV/Python" Python
	)
	LIPO_ARCH=$([[ $ARCH == x64 ]] && echo x86_64 || echo arm64)
	find "$OUT/yt-dlp" -type f -print0 | xargs -0 file | grep "Mach-O universal" | cut -d: -f1 | while read -r f; do
		lipo -thin $LIPO_ARCH "$f" -output "$f.thin" && mv "$f.thin" "$f"
	done
	echo "yt-dlp $YTDLP — The Unlicense (public domain). https://github.com/yt-dlp/yt-dlp" > "$OUT/licenses/yt-dlp.txt"

	# uv
	T="$(mktemp -d)"
	tar -xzf "$D/uv-$UV-$ARCH.tgz" -C "$T" --strip-components 1
	install -m 755 "$T/uv" "$OUT/bin/uv"
	rm -rf "$T"
	echo "uv $UV — MIT or Apache-2.0, Astral Software Inc. https://github.com/astral-sh/uv" > "$OUT/licenses/uv.txt"

	# Remotion renderer for this arch (only the matching compositor gets installed).
	R="$OUT/remotion"
	if [[ ! -f "$R/node_modules/@remotion/renderer/package.json" ]] || [[ "$(node -p "require('$R/node_modules/@remotion/renderer/package.json').version")" != "$REMOTION" ]]; then
		rm -rf "$R/node_modules"
		mkdir -p "$R"
		cat > "$R/package.json" <<EOF
{ "name": "render-engine", "private": true, "dependencies": { "@remotion/renderer": "$REMOTION", "@remotion/bundler": "$REMOTION" } }
EOF
		(cd "$R" && npm install --omit=dev --no-audit --no-fund --no-package-lock --os=darwin --cpu=$NPMCPU)
	fi
	ls "$R/node_modules/@remotion/" | grep -q "compositor-darwin-$NPMCPU" || { echo "compositor-darwin-$NPMCPU missing" >&2; exit 1; }

	# Chrome headless shell (Remotion's tested version), trimmed: no devtools frontend, no Vulkan validation layers.
	CH="$R/chrome-headless-shell/$CHPLAT"
	if [[ ! -x "$CH/chrome-headless-shell-$CHPLAT/chrome-headless-shell" ]]; then
		Z="$D/chrome-headless-shell-$CHPLAT-$CHROME.zip"
		[[ -f "$Z" ]] || curl -fL --retry 3 -o "$Z" "$CHURL"
		rm -rf "$CH"; mkdir -p "$CH"
		unzip -q -o "$Z" -d "$CH"
		local_dir="$CH/chrome-headless-shell-$CHPLAT"
		rm -rf "$local_dir/gen" "$local_dir/pyproto" "$local_dir/libVkLayer_khronos_validation.dylib" "$local_dir/libVkICD_mock_icd.dylib"
		strip -x "$local_dir/chrome-headless-shell"
		echo "$CHROME" > "$R/chrome-headless-shell/VERSION"
	fi
	echo "Remotion $REMOTION — Remotion License (https://remotion.dev/license). Chrome headless shell $CHROME — BSD-style licence, see chrome-headless-shell/*/LICENSE.headless_shell" > "$OUT/licenses/remotion.txt"

	# whisper-cli (whisper.cpp, MIT), static, for macOS 13+: Metal on Apple silicon, Accelerate/AVX2 on Intel.
	# Built from the release tarball with a pip-installed CMake (uvx); needs Xcode command line tools.
	if [[ ! -x "$OUT/bin/whisper-cli" ]]; then
		fetch https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.5.tar.gz "$D/whisper.cpp-1.9.5.tar.gz" ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720
		WB="$V/build/whisper-$ARCH"; rm -rf "$WB"; mkdir -p "$WB"
		tar -xzf "$D/whisper.cpp-1.9.5.tar.gz" -C "$WB" --strip-components 1
		if [[ $ARCH == arm64 ]]; then
			WFLAGS=(-DCMAKE_OSX_ARCHITECTURES=arm64 -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON)
		else
			WFLAGS=(-DCMAKE_OSX_ARCHITECTURES=x86_64 -DGGML_METAL=OFF -DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON)
		fi
		uvx cmake -S "$WB" -B "$WB/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
			-DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_SDL2=OFF -DGGML_BLAS=ON $WFLAGS >/dev/null
		uvx cmake --build "$WB/build" --config Release -j 8 --target whisper-cli >/dev/null
		install -m 755 "$WB/build/bin/whisper-cli" "$OUT/bin/whisper-cli"
		rm -rf "$WB"
	fi
	echo "whisper.cpp 1.9.5 — MIT, ggml-org. https://github.com/ggml-org/whisper.cpp" > "$OUT/licenses/whisper.cpp.txt"

	# An Intel build also needs Electron for x64 and the x64 image library of the web server (sharp).
	if [[ $ARCH == x64 ]]; then
		EV="$(node -p "require('$HERE/node_modules/electron/package.json').version")"
		[[ "$EV" == "44.9.1" ]] || { echo "Electron is $EV: update the x64 checksum in fetch-vendor.sh" >&2; exit 1; }
		fetch "https://github.com/electron/electron/releases/download/v$EV/electron-v$EV-darwin-x64.zip" "$D/electron-v$EV-darwin-x64.zip" 27afc06d37b32b637d27fb20730a4ae7c2ce5a4d9351d84b9faf42f1f9dd6017
		if [[ ! -d "$OUT/electron/Electron.app" ]]; then
			rm -rf "$OUT/electron"; mkdir -p "$OUT/electron"
			ditto -x -k "$D/electron-v$EV-darwin-x64.zip" "$OUT/electron"
		fi
		if [[ ! -d "$OUT/sharp/node_modules/@img/sharp-darwin-x64" ]]; then
			mkdir -p "$OUT/sharp"
			echo '{ "name": "sharp-x64", "private": true }' > "$OUT/sharp/package.json"
			(cd "$OUT/sharp" && npm install --force --no-audit --no-fund --no-package-lock --os=darwin --cpu=x64 @img/sharp-darwin-x64@0.34.5 @img/sharp-libvips-darwin-x64@1.2.4)
		fi
	fi
	echo "vendor/$ARCH ready: $(du -sh "$OUT" | cut -f1)"
done

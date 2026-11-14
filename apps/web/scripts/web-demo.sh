#!/bin/zsh
# Gaziyav in the browser — the editor as a static site (GitHub Pages or any static host; no server of ours, ever).
#   zsh apps/web/scripts/web-demo.sh [step] [tree]   (tree: the repository root, default the one holding this script;
#                                                      its node_modules installed: `bun install` at the root)
#   step all (default) → layer + build + site   (the site lands in <tree>/site-out, or $GZ_SITE_OUT)
#   step layer         → the build copy: a clone of the tree ($GZ_BUILD_COPY, default $TMPDIR/gaziyav-web-demo-build),
#                        the layer's payload files put in place and its patches applied (web-demo/layer/apply.py) —
#                        the tree itself is never changed: the desktop app builds from it exactly as before
#   step build         → only the static export of the editor, in the build copy (<copy>/apps/web/out)
#   step site          → only the site from an existing export (landing, editor/, worker, manifest, checks)
#   step sample        → makes the sample media again (ffmpeg + the Mac's `say`, nothing downloaded)
#   step test          → the proof (web-demo/test.mjs) on the built site; GZ_ELECTRON=<a Chromium shell>
#   step test-lipsync  → the lipsync walk against the stand-in provider (web-demo/test-lipsync.mjs) on a TEST site
# GZ_LEAK_SCAN=<leak-scan.mjs> runs the leak scan on the site at the end of `site`. GZ_DOCS_ASSETS = the docs' pictures
# (default <tree>/assets: brand/banner-*, brand/social-preview-*). GZ_TEST_PROVIDER=http://127.0.0.1:<port> makes a
# TEST site whose lipsync talks to a local stand-in (CSP and the page let that one origin through) — never publish it.
# The export is a `next build` with NEXT_PUBLIC_GAZIYAV_DEMO=1 (next.config.ts after the layer's patch). On a machine
# shared by several builds, GZ_BUILD_LOCK=<folder prefix> makes it take turns (GZ_BUILD_SLOTS of them).
set -e
TREE="${2:-${0:A:h:h:h:h}}"; TREE="${TREE:A}"
HERE="$TREE/apps/web/scripts/web-demo"
COPY="${GZ_BUILD_COPY:-${TMPDIR:-/tmp}/gaziyav-web-demo-build}"; COPY="${COPY%/}"
WEB="$COPY/apps/web"
OUT="${GZ_SITE_OUT:-$TREE/site-out}"
DOCS="${GZ_DOCS_ASSETS:-$TREE/assets}"
step="${1:-all}"

take_lock() {
	[[ -n "${GZ_BUILD_LOCK:-}" ]] || return 0
	LOCK=""
	while [[ -z "$LOCK" ]]; do
		CANDS=("$GZ_BUILD_LOCK"); for i in $(seq 2 ${GZ_BUILD_SLOTS:-1}); do CANDS+=("$GZ_BUILD_LOCK.$i"); done
		for cand in $CANDS; do
			if mkdir "$cand" 2>/dev/null; then LOCK="$cand"; break; fi
			owner=$(cat "$cand/pid" 2>/dev/null)
			if [[ -n "$owner" ]]; then kill -0 "$owner" 2>/dev/null || rm -rf "$cand"; fi
		done
		[[ -z "$LOCK" ]] && { echo "waiting for the build lock…"; sleep 15; }
	done
	echo $$ > "$LOCK/pid"
	trap '[[ "$(cat "$LOCK/pid" 2>/dev/null)" == "$$" ]] && rm -rf "$LOCK"' EXIT INT TERM
}

layer() {
	[[ -d "$TREE/node_modules" ]] || { echo "FAILED: $TREE has no node_modules — run \`bun install\` at its root first"; exit 1; }
	[[ "$COPY" == /*/* && "$COPY" != "$TREE" && "$COPY" != "$TREE"/* ]] || { echo "FAILED: GZ_BUILD_COPY must be an absolute folder outside the tree"; exit 1; }
	rm -rf "$COPY"; mkdir -p "$COPY"
	# an APFS clone where it can (cp -c), a plain copy elsewhere; the repository's history and earlier output stay out
	find "$TREE" -mindepth 1 -maxdepth 1 ! -name .git ! -name site-out -print0 | while IFS= read -r -d '' f; do
		cp -cR "$f" "$COPY/" 2>/dev/null || cp -R "$f" "$COPY/"
	done
	# the payload: files that compile only with the patches (kept as «.in», outside every compiled root of the tree)
	(cd "$HERE/layer/payload" && find . -type f -name '*.in') | while IFS= read -r f; do
		dest="$WEB/${${f#./}%.in}"; mkdir -p "${dest:h}"; cp "$HERE/layer/payload/$f" "$dest"
	done
	python3 "$HERE/layer/apply.py" "$WEB"
	# the speech recogniser's WebAssembly runtime (captions): served by the site itself — the page loads no code from a CDN
	ORT=""; for d in "$WEB/node_modules/@huggingface/transformers/dist" "$COPY/node_modules/@huggingface/transformers/dist"; do [[ -f "$d/ort-wasm-simd-threaded.jsep.wasm" ]] && { ORT="$d"; break; }; done
	[[ -n "$ORT" ]] || { echo "FAILED: the speech runtime (@huggingface/transformers) is not installed in the tree"; exit 1; }
	mkdir -p "$WEB/public/ort" && cp "$ORT/ort-wasm-simd-threaded.jsep.mjs" "$ORT/ort-wasm-simd-threaded.jsep.wasm" "$WEB/public/ort/"
	# the WebAssembly engine: the tree's own build of it (rust/wasm/pkg), whatever the installed copy holds
	if [[ -d "$COPY/rust/wasm/pkg" ]]; then
		find "$COPY/node_modules/.bun" -maxdepth 3 -type d -path '*opencut-wasm@*/node_modules/opencut-wasm' 2>/dev/null | while IFS= read -r w; do cp "$COPY"/rust/wasm/pkg/* "$w/"; done
	fi
	echo "LAYERED $COPY"
}

build() {
	[[ -f "$WEB/src/app/page.demo.tsx" ]] || layer
	take_lock
	cd "$WEB"
	rm -rf out
	loop=""; [[ -f "$DOCS/loops/lipsync-en.mp4" ]] && loop=1
	env NEXT_PUBLIC_GAZIYAV_DEMO=1 NEXT_PUBLIC_GAZIYAV_DEMO_LOOP="$loop" NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production \
		nice -n 10 ./node_modules/.bin/next build
	[[ -f out/index.html ]] || { echo "FAILED: no out/index.html"; exit 1; }
	echo "BUILT $WEB/out"
}

site() {
	[[ -f "$WEB/out/index.html" ]] || { echo "FAILED: no export at $WEB/out (step build)"; exit 1; }
	node "$HERE/post.mjs" "$WEB/out" "$OUT" "$HERE" "$DOCS" "$TREE/apps/web/src/demo/connect-hosts.json" "$TREE/apps/web"
}

case "$step" in
	all) layer; build; site ;;
	layer) layer ;;
	build) build ;;
	site) site ;;
	sample) cd "$HERE/sample" && zsh "$HERE/sample.sh" . ;;
	test) node "$HERE/test.mjs" "$OUT" "${GZ_PORT:-4011}" "${GZ_DEBUG_PORT:-10011}" ;;
	test-lipsync) node "$HERE/test-lipsync.mjs" "$OUT" "${GZ_PORT:-4013}" "${GZ_DEBUG_PORT:-10013}" "$TREE" ;;
	*) echo "usage: $0 [all|layer|build|site|sample|test|test-lipsync] [tree]" >&2; exit 2 ;;
esac

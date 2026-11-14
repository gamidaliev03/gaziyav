#!/usr/bin/env bash
# Builds our own opencut-wasm (rust/wasm) into rust/wasm/pkg — the package the
# web app depends on ("opencut-wasm": "file:../../rust/wasm/pkg").
#
# Requirements (one-time):
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-bindgen-cli --version 0.2.116   # must match Cargo.lock
#   (optional) brew install binaryen                    # wasm-opt, smaller/faster binary
#
# Usage (from the repo root):   bash scripts/build-wasm.sh
# bun copies file: deps into node_modules/.bun, so the script drops that copy
# and re-runs `bun install` to pick up the fresh build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$ROOT/rust/wasm/pkg"
CARGO="${CARGO:-$(command -v cargo || echo "$HOME/.cargo/bin/cargo")}"
BINDGEN="${WASM_BINDGEN:-$(command -v wasm-bindgen || echo "$HOME/.cargo/bin/wasm-bindgen")}"
VERSION="0.2.10-studio.1"

echo "› cargo build (wasm32, release)"
RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$HOME/.cargo/registry/src=/cargo --remap-path-prefix=$HOME=/home --remap-path-prefix=$ROOT=/gaziyav" "$CARGO" build --manifest-path "$ROOT/rust/wasm/Cargo.toml" \
	--target wasm32-unknown-unknown --release

WASM="$ROOT/target/wasm32-unknown-unknown/release/opencut_wasm.wasm"
[ -f "$WASM" ] || { echo "wasm artifact not found: $WASM" >&2; exit 1; }

echo "› wasm-bindgen ($("$BINDGEN" --version))"
TMP="$(mktemp -d)"
"$BINDGEN" "$WASM" --target bundler --out-dir "$TMP" --out-name opencut_wasm

if command -v wasm-opt >/dev/null 2>&1; then
	echo "› wasm-opt -O3"
	wasm-opt -O3 --enable-bulk-memory --enable-nontrapping-float-to-int \
		"$TMP/opencut_wasm_bg.wasm" -o "$TMP/opencut_wasm_bg.wasm"
fi

mkdir -p "$PKG"
rm -f "$PKG"/opencut_wasm*
cp "$TMP"/opencut_wasm* "$PKG/"
rm -rf "$TMP"

cat >"$PKG/package.json" <<JSON
{
  "name": "opencut-wasm",
  "type": "module",
  "description": "Gaziyav build of opencut-wasm (generic effect engine, runtime WGSL shaders, transitions)",
  "version": "$VERSION",
  "license": "MIT",
  "files": ["opencut_wasm_bg.wasm", "opencut_wasm.js", "opencut_wasm_bg.js", "opencut_wasm.d.ts"],
  "main": "opencut_wasm.js",
  "types": "opencut_wasm.d.ts",
  "sideEffects": ["./opencut_wasm.js", "./snippets/*"]
}
JSON

BUN="${BUN:-$(command -v bun || echo "$HOME/.bun/bin/bun")}"
if [ -x "$BUN" ]; then
	echo "› refreshing node_modules copy"
	rm -rf "$ROOT"/node_modules/.bun/opencut-wasm@file*
	(cd "$ROOT" && "$BUN" install >/dev/null)
fi

echo "✓ $PKG ($(du -h "$PKG/opencut_wasm_bg.wasm" | cut -f1)) version $VERSION"

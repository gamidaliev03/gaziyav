#!/bin/zsh
# Builds Gaziyav from scratch and packs it into a drag-to-Applications DMG (lzfse-compressed, ad-hoc signed).
#   ./make-dmg.sh                 arm64 (Apple silicon)
#   ARCH=x64 ./make-dmg.sh        Intel
#   SKIP_BUILD=1 ./make-dmg.sh    pack the last build in dist/ (no rebuild)
#   SEED_DIR=… DMG_SUFFIX=-with-models ./make-dmg.sh   the «with models» build (every model inside, no downloads)
# Output: dist/Gaziyav-<version>-<arch>.dmg. The window: app on the left, Applications on the right, a light brand
# background (drawn by dmg/render-background.swift, 660×400 pt @2x) with the first-launch instructions. Uses dmgbuild
# (pip, via uvx) so no Finder scripting is needed; dmg/fix-background.py makes the background show on macOS 15.
set -euo pipefail
HERE="${0:A:h}"
ARCH="${ARCH:-arm64}"
VERSION="${VERSION:-1.0}"
DIST="${OUT_DIR:-$HERE/dist}"
APPNAME="${APP_DIR_NAME:-Gaziyav}"
APP="$DIST/$APPNAME.app"
DMG="$DIST/${DMG_NAME:-Gaziyav}-$VERSION-$ARCH${DMG_SUFFIX:-}.dmg"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [[ -z "${SKIP_BUILD:-}" ]]; then
	ARCH=$ARCH VERSION=$VERSION OUT_DIR="$DIST" "$HERE/build.sh"
fi
[[ -d "$APP" ]] || { echo "no app at $APP" >&2; exit 1; }
codesign --verify --deep --strict "$APP"

# Background: the light brand canvas with the first-launch lines (Finder draws icon labels in black on a picture).
REQ="Нужна macOS 14 или новее."
[[ $ARCH == arm64 ]] && REQ="Для Mac на Apple silicon (M1 и новее), macOS 14 или новее."
[[ $ARCH == x64 ]] && REQ="Для Mac на Intel, macOS 14 или новее. Локальный ИИ работает только на Apple silicon."
FONT="$APP/Contents/Resources/web/apps/web/public/fonts/bundled/Unbounded.ttf"; [[ -f "$FONT" ]] || FONT="-"
# The family DMG (its app's Resources/edition says «family») gets the family's window: the workshop's wood, the family's
# arch and a paper card under the two icons (brand/family/dmg-art@2x.png), the same lines in cream. DMG_BACKGROUND_SWIFT= overrides.
BG_SWIFT="$HERE/dmg/render-background.swift"
[[ "$(cat "$APP/Contents/Resources/edition" 2>/dev/null)" == family && -f "$HERE/brand/family/dmg-art@2x.png" ]] && BG_SWIFT="$HERE/brand/family/render-dmg-background.swift"
BG_SWIFT="${DMG_BACKGROUND_SWIFT:-$BG_SWIFT}"
GAZIYAV_ICON="$HERE/icon.icns" swift "$BG_SWIFT" "$FONT" "$WORK/background@2x.png" \
	"Перетащи ${APP_DIR_NAME:+«}$APPNAME${APP_DIR_NAME:+»} в «Программы» и открой." \
	"Не открывается: Настройки → Конфиденциальность и безопасность → Всё равно открыть." \
	"$REQ"
sips -z 400 660 "$WORK/background@2x.png" --out "$WORK/background.png" >/dev/null
tiffutil -cathidpicheck "$WORK/background.png" "$WORK/background@2x.png" -out "$WORK/background.tiff" >/dev/null 2>&1

# The image's size from the app's real size (+15 % and 300 MB for the file system): dmgbuild's own estimate came out
# short for a 2.5 GB app and the copy stopped half-way (Electron Framework missing, "is damaged" after download).
SIZE_MB=$(( $(du -sm "$APP" | cut -f1) * 115 / 100 + 300 ))
# LOW_DISK=1 (a nearly full disk): dmgbuild writes the compressed image straight away (one working image, not two),
# with less spare room; the app's signature is checked inside the finished image, so a short copy can't pass.
FORMAT="UDRW"
if [[ -n "${LOW_DISK:-}" ]]; then FORMAT="ULFO"; fi
cat > "$WORK/settings.py" <<EOF
files = [r"$APP"]
symlinks = {"Applications": "/Applications"}
format = "$FORMAT"  # read-write first: the background alias is fixed below, then the image is compressed
filesystem = "HFS+"
size = "${SIZE_MB}M"
background = r"$WORK/background.tiff"
window_rect = ((200, 120), (660, 428))  # 400 pt of content under the 28 pt title bar
icon_size = 112
text_size = 13
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
default_view = "icon-view"
icon_locations = {"$APPNAME.app": (170, 200), "Applications": (490, 200)}
# No hide_extensions: it writes Finder info onto the bundle, which breaks the seal ("is damaged").
EOF
rm -f "$DMG"
if [[ -n "${LOW_DISK:-}" ]]; then
	uvx --from dmgbuild==1.6.7 dmgbuild -s "$WORK/settings.py" "$APPNAME" "$DMG"
else
uvx --from dmgbuild==1.6.7 dmgbuild -s "$WORK/settings.py" "$APPNAME" "$WORK/rw.dmg"
# macOS 15's Finder ignores dmgbuild's background alias (a fixed disk, the picture at the root): rewrite it the way
# Finder writes it for a disk image (ejectable, /.background/), then compress with lzfse.
RW="$(hdiutil attach -readwrite -noautoopen -nobrowse "$WORK/rw.dmg" | tail -1 | awk -F'\t' '{print $NF}')"
uvx --from ds-store==1.3.3 --with mac-alias==2.2.3 python -I "$HERE/dmg/fix-background.py" "$RW"
hdiutil detach "$RW" -quiet
hdiutil convert "$WORK/rw.dmg" -format ULFO -o "$DMG" -quiet
fi
# The image itself gets an ad-hoc signature too (no Developer ID: users confirm the first launch, see the text).
codesign --force --sign - "$DMG"
hdiutil verify "$DMG" >/dev/null
# The app inside must still pass a strict signature check (anything else shows "is damaged" after download).
M="$(hdiutil attach -nobrowse -noautoopen -readonly "$DMG" | tail -1 | awk -F'\t' '{print $NF}')"
codesign --verify --deep --strict "$M/$APPNAME.app" || { hdiutil detach "$M" -quiet; rm -f "$DMG"; echo "the app in the DMG fails codesign --strict (image removed)" >&2; exit 1; }
# Same files as the build, byte for byte in count and size (a short copy is caught here, not by users).
want=$(cd "$APP" && find . -type f | wc -l | tr -d ' '); got=$(cd "$M/$APPNAME.app" && find . -type f | wc -l | tr -d ' ')
[[ "$want" == "$got" ]] || { hdiutil detach "$M" -quiet; rm -f "$DMG"; echo "the DMG holds $got files, the app $want (image removed)" >&2; exit 1; }
# Nothing personal goes to a friend's Mac (1.0.72): no key or token, nothing of this Mac's user (the e-mail, the home
# folder, their own faces and voices), and not the owner's agent key unless ALLOW_AGENT_KEY=1. Keys are never printed.
leaks="$(/usr/bin/python3 - "$M/$APPNAME.app" "$HOME" "$(git config user.email 2>/dev/null)" "${ALLOW_AGENT_KEY:-}" <<'PY'
import hashlib, os, re, sys
app, home, email, allow_key = sys.argv[1:5]
tokens = re.compile(rb"hf_[A-Za-z0-9]{30,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[abp]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----")
needles = [(n.encode(), what) for n, what in ((home + "/", "a path of this Mac"), (email, "the user's e-mail")) if n]
mine = set()
for d in ("Faces", "Voices"):
    for root, _, files in os.walk(os.path.join(home, "Library", "Application Support", "Gaziyav", d)):
        for f in files:
            try:
                mine.add(hashlib.sha256(open(os.path.join(root, f), "rb").read()).hexdigest())
            except OSError:
                pass
found = []
for root, _, files in os.walk(app):
    for f in files:
        p = os.path.join(root, f)
        if os.path.islink(p):
            continue
        rel = os.path.relpath(p, app)
        if f == "agent.key" and not allow_key:
            found.append(f"{rel}: the owner's agent key")
            continue
        data = open(p, "rb").read()
        found += [f"{rel}: {what}" for n, what in needles if n in data]
        if b"\0" not in data[:8192] and (m := tokens.search(data)):
            found.append(f"{rel}: a token ({m.group(0)[:3].decode(errors='replace')}…)")
        # A 2-byte «[]» (an empty faces.json / Next manifest) cannot be a face or a voice sample: matching its
        # hash flagged the build's own empty JSON as personal data and removed a good DMG.
        if mine and len(data) > 32 and hashlib.sha256(data).hexdigest() in mine:
            found.append(f"{rel}: one of the user's own faces or voices")
print("\n".join(found[:20]))
PY
)"
[[ -z "$leaks" ]] || { hdiutil detach "$M" -quiet; rm -f "$DMG"; printf 'the DMG carries something personal (image removed):\n%s\n' "$leaks" >&2; exit 1; }
# A friend's first launch: a copy with the download flag Safari leaves must only lack the notarization (macOS then
# offers «Open Anyway» in Privacy & Security), never fail its signature («is damaged and can't be opened»).
# LOW_DISK=1: no room for a second copy of the app — the signature is checked inside the mounted image instead.
if [[ -n "${LOW_DISK:-}" ]]; then
	quarantined="$(codesign --verify --deep --strict "$M/$APPNAME.app" 2>&1 || true)"
else
	Q="$(mktemp -d)"
	ditto "$M/$APPNAME.app" "$Q/$APPNAME.app"
	xattr -w -r com.apple.quarantine "0083;$(printf %x "$(date +%s)");Safari;" "$Q/$APPNAME.app"
	quarantined="$(codesign --verify --deep --strict "$Q/$APPNAME.app" 2>&1 && syspolicy_check distribution "$Q/$APPNAME.app" 2>&1 | grep -E '^[A-Z]' | grep -v -E '^(App has failed|Notary Ticket Missing)' || true)"
	rm -rf "${Q:?}"
fi
[[ -z "$quarantined" ]] || { hdiutil detach "$M" -quiet; rm -f "$DMG"; printf 'a downloaded copy would not open with «Open Anyway» (image removed):\n%s\n' "$quarantined" >&2; exit 1; }
hdiutil detach "$M" -quiet
echo "DMG: $DMG ($(du -h "$DMG" | cut -f1); app $(du -sh "$APP" | cut -f1))"

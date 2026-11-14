#!/bin/zsh
# Sign a built Gaziyav.app again after a file was added to it (the installer's marker): with the owner's identity
# «Gaziyav Dev» when it exists (see build.sh), else ad hoc.   zsh sign-app.sh dist/rcN/Gaziyav.app
APP="${1:?the .app to sign}"
ID="${GAZIYAV_SIGN_ID:-$(security find-identity -p codesigning 2>/dev/null | grep -q '"Gaziyav Dev"' && echo "Gaziyav Dev" || printf '%s' -)}"
codesign --force --deep --sign "$ID" --timestamp=none "$APP" && codesign --verify --deep --strict "$APP" && echo "signed with: $ID"

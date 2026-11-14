#!/bin/zsh
# The browser test of lipsync in the page. Needs ffmpeg on PATH; ports 4041 (provider front) and 4042 (page).
#   zsh run.sh <shell tree> <scratch dir> [<pubdemo's src/demo dir>]
# Without the third argument the page uses its own small shim; with it, pubdemo's installDemoApi + registerBrowserAi.
SH=$1; N=$2; DEMO=$3
H=${0:A:h}; W=${H:h:h:h:h}
E="$SH/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
mkdir -p $N/site/media $N/entry
[[ -f $N/site/media/src.mp4 ]] || ffmpeg -y -v error -f lavfi -i "testsrc2=s=1440x2560:r=30:d=6" -f lavfi -i "sine=frequency=220:duration=6:sample_rate=48000" -c:v libx264 -preset veryfast -pix_fmt yuv420p -g 30 -c:a aac -b:a 128k -shortest $N/site/media/src.mp4
[[ -f $N/site/media/voice.m4a ]] || ffmpeg -y -v error -f lavfi -i "sine=frequency=330:duration=3:sample_rate=48000" -c:a aac $N/site/media/voice.m4a
PAGE=page.js
if [[ -n $DEMO ]]; then
	PAGE=page-pubdemo.js
	cat > $N/entry/pubdemo-mount.ts <<EOT
import { installDemoApi } from "$DEMO/api-shim";
import { registerBrowserAi } from "$DEMO/ai-adapter";
import { mountWebLipsync } from "$H/../adapter";
const nativeFetch = window.fetch.bind(window);
// native fetch only because the stand-in's origin is not in connect-hosts.json
const made = mountWebLipsync(registerBrowserAi, { fetch: nativeFetch, route: (u) => u.replace(/^https:\/\//, "http://127.0.0.1:4041/"), pollMs: 150, lang: () => "ru" });
installDemoApi();
Object.assign(globalThis, { __gzMade: made, __gzNativeFetch: nativeFetch });
EOT
	printf 'import "./pubdemo-mount";\nimport "%s/page";\n' "$H" > $N/entry/page-pubdemo.ts
	(cd "$W" && bun build $N/entry/page-pubdemo.ts --target browser --outfile $N/site/page-pubdemo.js >/dev/null) || exit 1
else
	(cd "$W" && bun build "$H/page.ts" --target browser --outfile $N/site/page.js >/dev/null) || exit 1
fi
OUT=$N/run-${PAGE%.js}; mkdir -p $OUT
PAGE=$PAGE FAKE_FAL="$SH/test/fake-fal.mjs" SITE=$N/site OUT=$OUT FFMPEG=$(command -v ffmpeg) "$E" "$H/run.mjs" > $OUT.log 2>&1
code=$?
grep -E "^(ok|FAIL)" $OUT/progress.txt | cut -c1-240; grep "passed" $OUT.log
exit $code

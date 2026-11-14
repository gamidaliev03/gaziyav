// The AI layers' fonts as files of the app (public/montage-fonts): the families src/montage/remotion/fonts.ts and
// mograph/fonts.ts load, OFL, taken once from the addresses @remotion/google-fonts knows. The player and the renderer
// read them from here (src/montage/remotion/local-fonts.ts), so a session never calls fonts.gstatic.com.
//   node scripts/fetch-montage-fonts.mjs   (from apps/web; only what's missing)
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(WEB, "package.json"));
const OUT = path.join(WEB, "public", "montage-fonts");
const WANT = {
	Unbounded: ["700", "800", "900"],
	Onest: ["500", "700", "800", "900"],
	Montserrat: ["700", "800", "900"],
	Manrope: ["500", "600", "700", "800"],
	Rubik: ["600", "700", "800", "900"],
	PlayfairDisplay: ["500", "600", "700"],
	GolosText: ["500", "600", "700"],
	NotoColorEmoji: ["400"],
	Bangers: ["400"],
	ShareTechMono: ["400"],
	VT323: ["400"],
};
const urls = new Set();
for (const [family, weights] of Object.entries(WANT)) {
	const { fonts } = require(`@remotion/google-fonts/${family}`).getInfo();
	for (const [style, byWeight] of Object.entries(fonts)) {
		if (style !== "normal" && !(family === "PlayfairDisplay" && style === "italic")) continue;
		for (const w of weights) for (const [subset, url] of Object.entries(byWeight[w] ?? {})) if (family === "NotoColorEmoji" || subset === "latin" || subset === "cyrillic") urls.add(url);
	}
}
fs.mkdirSync(OUT, { recursive: true });
let got = 0;
for (const url of urls) {
	const name = new URL(url).pathname.replace(/^\/s\//, "").replaceAll("/", "_");
	const file = path.join(OUT, name);
	if (fs.existsSync(file)) continue;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url}: ${res.status}`);
	const bytes = Buffer.from(await res.arrayBuffer());
	if (bytes.subarray(0, 4).toString("latin1") !== "wOF2") throw new Error(`${url}: not a woff2 file`);
	fs.writeFileSync(file, bytes);
	got++;
}
console.log(`montage fonts: ${urls.size} files, ${got} fetched now`);

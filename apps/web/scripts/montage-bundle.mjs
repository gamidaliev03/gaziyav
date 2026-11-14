// Prebuilds the Remotion bundle of the AI layers (src/montage/remotion/entry.tsx) into public/montage-bundle,
// so the export renderer needs no webpack at runtime. Uses the Remotion engine of desktop/vendor/<arch>/remotion (fetch-vendor.sh) or MONTAGE_REMOTION_DIR.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "..");
const engine = process.env.MONTAGE_REMOTION_DIR || path.resolve(WEB, "..", "..", "desktop", "vendor", process.arch === "x64" ? "x64" : "arm64", "remotion");
if (!fs.existsSync(path.join(engine, "node_modules", "@remotion", "bundler"))) {
	console.warn(`montage-bundle: no @remotion/bundler in ${engine} — skipped (AI layers can't be exported from this build)`);
	process.exit(0);
}
const require = createRequire(path.join(engine, "package.json"));
const { bundle } = require("@remotion/bundler");
const outDir = path.join(WEB, "public", "montage-bundle");
fs.rmSync(outDir, { recursive: true, force: true });
const started = Date.now();
await bundle({
	entryPoint: path.join(WEB, "src", "montage", "remotion", "entry.tsx"),
	outDir,
	publicDir: path.join(WEB, "src", "montage", "remotion", "public"),
	enableCaching: false,
});
for (const f of fs.readdirSync(outDir)) if (f.endsWith(".map") && f !== "bundle.js.map") fs.rmSync(path.join(outDir, f));
// the AI layers' fonts: the renderer reads them from its own server (src/montage/remotion/local-fonts.ts)
fs.cpSync(path.join(WEB, "public", "montage-fonts"), path.join(outDir, "montage-fonts"), { recursive: true });
// The bundler writes the folder it ran in into the page (window.remotion_cwd, for its Studio only): no trace of the
// Mac that built the app goes inside it.
const page = path.join(outDir, "index.html");
fs.writeFileSync(page, fs.readFileSync(page, "utf8").replace(/window\.remotion_cwd = "[^"]*"/, 'window.remotion_cwd = ""'));
console.log(`montage-bundle: ${outDir} in ${((Date.now() - started) / 1000).toFixed(1)} s`);

// The browser edition's music and sound library: the desktop's catalogs (vendor/library-pc) as one static file,
// public/sound-library.json, with the address of every file — Gaziyav's public dataset on the owner's Hugging Face for what is
// there, the publisher's own server (Mixkit) for the rest. The app lists it like the desktop's library
// (library/server/index-store.ts kadr(): ids ks-/km-, same fields); src/demo/api-shim.ts answers /api/library/* with it.
//   node apps/web/scripts/web-demo/sound-library.mjs <vendor/library-pc> [out]
import fs from "node:fs";
import path from "node:path";

const [, , catalog, out = path.join(import.meta.dirname, "../../public/sound-library.json")] = process.argv;
if (!catalog) throw new Error("usage: sound-library.mjs <vendor/library-pc> [out]");
const DATASET = "https://huggingface.co/datasets/adsfadfadsfadsf/gaziyav-media/resolve/main";
const gains = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../../src/library/gains.json"), "utf8"));
const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
const items = [];
for (const [kind, folder, prefix] of [["sfx", "Sound Effects", "ks-"], ["music", "Music", "km-"]]) {
	for (const r of JSON.parse(fs.readFileSync(path.join(catalog, folder, "library.json"), "utf8"))) {
		if (!r?.file || !r.title) continue;
		const url = r.hf ? `${DATASET}/${enc(`${folder}/${r.file}`)}` : r.url;
		if (!url) continue;
		const gain = gains[`${folder}/${r.id}`];
		items.push({
			id: `${prefix}${r.id}`,
			kind,
			name: r.title,
			cat: r.group || "Other",
			tags: [r.tag, r.artist].filter((t) => typeof t === "string" && t),
			dur: Number(r.dur) || 0,
			src: "kadr",
			url,
			...(r.peaks ? { peaks: r.peaks } : {}),
			...(r.top ? { top: r.top } : {}),
			...(r.artist ? { artist: r.artist } : {}),
			...(r.license ? { license: r.license } : {}),
			...(gain ? { gain } : {}),
		});
	}
}
fs.writeFileSync(out, JSON.stringify(items));
console.log(`sound-library: ${items.length} items (${items.filter((i) => i.kind === "music").length} music) → ${out}`);

// Levels the music and sound library: every file is measured with ffmpeg (EBU R128) and gets the gain, in dB, that
// brings it to the library's level — music by integrated loudness, sounds (too short for that) by their loudest
// 400 ms, both to −14 LUFS, never above −1 dBTP, within ±12 dB. The Audio tab plays and places each file with its gain
// (library/gain.ts has the rule; library/server/index-store.ts reads the table; the clip's volume carries it).
//   bun scripts/library-gain.ts <library dir with Music/ and Sound Effects/> [apps/web/src/library/gains.json]
// Needs ffmpeg on PATH. Keys are "<part>/<id>" of library.json; a file whose gain rounds to 0 is left out.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { gainFor } from "../apps/web/src/library/gain";

const [src, outArg] = process.argv.slice(2);
if (!src) throw new Error("usage: bun scripts/library-gain.ts <library dir> [out.json]");
const out = outArg ?? path.join(import.meta.dirname, "../apps/web/src/library/gains.json");

function measure(file: string): { integrated: number | null; momentaryMax: number | null; truePeak: number | null } {
	const r = spawnSync("ffmpeg", ["-nostats", "-hide_banner", "-i", file, "-af", "ebur128=peak=true:metadata=1,ametadata=print:key=lavfi.r128.M:file=-", "-f", "null", "-"], { maxBuffer: 1 << 26, encoding: "utf8" });
	const integrated = /\n\s+I:\s+(-?[\d.]+) LUFS/.exec(r.stderr);
	const peak = /True peak:\s*\n?\s*Peak:\s+(-?[\d.]+) dBFS/.exec(r.stderr);
	const moments = [...r.stdout.matchAll(/lavfi\.r128\.M=(-?[\d.]+)/g)].map((m) => Number(m[1])).filter((m) => m > -100);
	return { integrated: integrated ? Number(integrated[1]) : null, momentaryMax: moments.length ? Math.max(...moments) : null, truePeak: peak ? Number(peak[1]) : null };
}

if (import.meta.main) {
	const gains: Record<string, number> = {};
	let n = 0;
	for (const [part, kind] of [["Music", "music"], ["Sound Effects", "sfx"]] as const) {
		const rows = JSON.parse(fs.readFileSync(path.join(src, part, "library.json"), "utf8")) as Array<{ id: string; file: string }>;
		for (const row of rows) {
			const file = path.join(src, part, row.file);
			if (!fs.existsSync(file)) continue;
			const gain = gainFor({ kind, ...measure(file) });
			if (gain !== 0) gains[`${part}/${row.id}`] = gain;
			if (++n % 200 === 0) console.log(`${n} files…`);
		}
	}
	fs.writeFileSync(out, `${JSON.stringify(gains, null, 1)}\n`);
	console.log(`${Object.keys(gains).length} gains of ${n} files → ${out}`);
}

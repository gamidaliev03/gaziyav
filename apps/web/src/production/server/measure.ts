// The review's ears and eyes on the server. Sound: the project's own sources mixed by ffmpeg as the timeline plays
// them (pieces, gains, fades, speed, music ducked under speech) and measured with the EBU R128 meter — the whole mix,
// speech alone and music alone (so "music 12 dB under speech" is a number), per section, and silence holes. Pictures:
// frames the window rendered, judged by Apple Vision (framejudge). Plus the library picks for music and sounds.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getLibraryIndex, resolveLibraryFile } from "@/library/server/index-store";
import { findTool } from "@/studio/server/tools";
import { type JudgedFrame, judgeFrame, median } from "../material";
import { type MixPart, mixGraph } from "../mix-graph";
import type { SoundPick } from "../plan";
import type { Measured, RenderedFrame } from "../review";
import { analysisState, judge, requestAnalysis } from "./analyze";
import { readBrief, runQuiet, sourcePath } from "./store";

export type { MixPart } from "../mix-graph";

function fileOf(p: MixPart): string | null {
	if (p.library) return resolveLibraryFile(p.library);
	if (p.key) return sourcePath(p.key);
	return null;
}

/** M (momentary) loudness every 100 ms of each ebur128 in ffmpeg's log, by filter instance. */
function momentary(log: string): Map<string, number[]> {
	const out = new Map<string, number[]>();
	for (const line of log.split("\n")) {
		const m = /\[Parsed_ebur128_(\d+) @[^\]]*\]\s+t:\s*([\d.]+).*?M:\s*(-?[\d.]+|-inf)/.exec(line);
		if (!m) continue;
		const list = out.get(m[1]) ?? [];
		list.push(m[3] === "-inf" ? -120 : Number(m[3]));
		out.set(m[1], list);
	}
	return out;
}

export async function measureMix({ parts, total, speech, sections }: { parts: MixPart[]; total: number; speech: Array<[number, number]>; sections: Array<[number, number]> }): Promise<Measured> {
	const usable = parts.map((p) => ({ p, file: fileOf(p) })).filter((x): x is { p: MixPart; file: string } => !!x.file && x.p.to > x.p.from);
	if (!usable.length || total <= 0) return { lufs: null, truePeak: null, speechOverMusic: null, sections: [], holes: [] };
	const { files, chains, outputs, both } = mixGraph(usable, total, speech);
	const args = ["-hide_banner", "-nostdin", "-v", "info", ...files.flatMap((f) => ["-i", f]), "-filter_complex", chains.join(";"), ...outputs.flatMap((o) => ["-map", `[${o}]`, "-f", "null", "-"])];
	const r = await runQuiet(findTool("ffmpeg"), args, { timeout: Math.max(120, total * 2) });
	if (r.status !== 0) throw new Error(`The sound couldn't be measured: ${r.stderr.trim().split("\n").slice(-2).join(" ").slice(0, 300)}`);
	const log = r.stderr;
	const summaries = [...log.matchAll(/\[Parsed_ebur128_(\d+)[^\]]*\] Summary:[\s\S]*?I:\s+(-?[\d.]+|-inf) LUFS[\s\S]*?(?:Peak:\s+(-?[\d.]+|-inf) dBFS)?/g)];
	const series = momentary(log);
	const ids = [...series.keys()].sort((a, b) => Number(a) - Number(b));
	// ebur128 instances in the graph's order: all, then speech, then music.
	const allId = ids[0];
	const speechId = both ? ids[1] : undefined;
	const musicId = both ? ids[2] : undefined;
	const sumAll = summaries.find((s) => s[1] === allId);
	const lufs = sumAll && sumAll[2] !== "-inf" ? Number(sumAll[2]) : null;
	const tp = /Peak:\s+(-?[\d.]+) dBFS/.exec(log.slice(log.indexOf(`Parsed_ebur128_${allId}`) >= 0 ? log.lastIndexOf(`[Parsed_ebur128_${allId}`) : 0));
	const all = series.get(allId) ?? [];
	const sectionLufs = sections.map(([a, b]) => {
		const slice = all.slice(Math.max(0, Math.round(a * 10)), Math.round(b * 10)).filter((v) => v > -70);
		const energy = slice.length ? slice.reduce((s, v) => s + 10 ** (v / 10), 0) / slice.length : 0;
		return { from: a, to: b, lufs: energy > 0 ? Math.round(10 * Math.log10(energy) * 10) / 10 : null };
	});
	let speechOverMusic: number | null = null;
	if (speechId && musicId) {
		const s = series.get(speechId) ?? [];
		const m = series.get(musicId) ?? [];
		const diffs: number[] = [];
		for (let i = 0; i < Math.min(s.length, m.length); i++) if (s[i] > -35 && m[i] > -70) diffs.push(s[i] - m[i]);
		speechOverMusic = diffs.length ? Math.round(median(diffs) * 10) / 10 : null;
	}
	const holes = [...log.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1])).filter((t) => t > 0.2 && t < total - 0.3);
	return { lufs: lufs !== null ? Math.round(lufs * 10) / 10 : null, truePeak: tp ? Number(tp[1]) : null, speechOverMusic, sections: sectionLufs, holes };
}

/** Frames the window rendered (JPEG data), judged on this Mac. */
export async function judgeRendered(frames: Array<{ t: number; data: string }>): Promise<RenderedFrame[]> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gz-review-"));
	try {
		const files = frames.map((f, i) => {
			const file = path.join(dir, `r${String(i).padStart(3, "0")}.jpg`);
			fs.writeFileSync(file, Buffer.from(f.data.replace(/^data:image\/\w+;base64,/, ""), "base64"));
			return file;
		});
		const judged = await judge(files, frames.map((f) => f.t), undefined, { corners: false });
		const ref = median(judged.map((j) => j.sharp));
		return judged.map((j: JudgedFrame) => ({ t: j.t, verdict: judgeFrame(j, { sharp: ref }), faces: j.faces.map((f) => ({ box: f.box, eyes: f.eyes })), luma: j.luma, horizon: j.horizon }));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

// ───────────────────────── library picks ─────────────────────────

function pick(kind: "music" | "sfx", words: string, seconds = 0) {
	const index = getLibraryIndex();
	const want = words.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 2);
	const scored = index.items
		.filter((i) => i.kind === kind && (kind === "sfx" ? i.dur <= 6 : i.dur >= Math.min(seconds, 60)))
		.map((i) => {
			const hay = `${i.name} ${i.cat} ${i.tags.join(" ")}`.toLowerCase();
			const hits = want.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
			return { i, score: hits * 10 + (i.remote ? -5 : 0) + (kind === "music" && i.dur >= seconds ? 3 : 0) + (i.top ? 1 : 0) };
		})
		.sort((a, b) => b.score - a.score);
	return scored[0]?.i ?? null;
}

/** Music for a mood and a length (with its beat grid once analysed) and the sounds a preset names. */
export async function pickSounds({ mood, seconds, sfx }: { mood: string; seconds: number; sfx: Record<string, string> }): Promise<{ music: SoundPick | null; sfx: Record<string, SoundPick | null>; pending?: string }> {
	const toPick = (i: ReturnType<typeof pick>): SoundPick | null => (i ? { id: i.id, url: `/api/library/file/${encodeURIComponent(i.id)}`, name: i.name, dur: i.dur, gain: i.gain ?? 0 } : null);
	const m = pick("music", mood, seconds);
	let music = toPick(m);
	let pending: string | undefined;
	if (m && music) {
		const key = `lib-${m.id}`;
		const file = resolveLibraryFile(m.id);
		const brief = readBrief(key);
		if (brief?.music) music = { ...music, bpm: brief.music.bpm, downbeats: brief.music.downbeats };
		else if (file) {
			const st = analysisState(key) ?? requestAnalysis({ key, file, name: m.name, front: true, music: true });
			// The beat grid of a library track takes a few seconds: wait for it (once per track, cached).
			for (let i = 0; i < 120 && st && (analysisState(key)?.status === "queued" || analysisState(key)?.status === "running"); i++) await new Promise((r) => setTimeout(r, 250));
			const done = readBrief(key);
			if (done?.music) music = { ...music, bpm: done.music.bpm, downbeats: done.music.downbeats };
			else pending = "the music's beat grid isn't ready; it ends with a fade instead";
		}
	}
	const out: Record<string, SoundPick | null> = {};
	for (const [role, words] of Object.entries(sfx)) out[role] = toPick(pick("sfx", words));
	return { music, sfx: out, pending };
}

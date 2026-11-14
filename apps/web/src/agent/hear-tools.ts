// Claude's ears as tools (Gaziyav AI and the MCP connector): listen (the audio map + a picture of the sound),
// cut_point, check_cuts (finds and fixes bad cuts itself), fix_sound, and the seamless versions of transcript,
// cut_out, split and trim. The listening runs on the app's server (studio/server/hear.ts); here only the answers are
// put into words and the edits applied, each one ⌘Z.
import { Command, type CommandResult } from "@/commands/base-command";
import { BatchCommand } from "@/commands/batch-command";
import { EditorCore } from "@/core";
import { SEAM_FADE } from "@/hear/cuts";
import type { Note } from "@/hear/describe";
import {
	type ClipMap,
	checkSeams,
	cutPointsAt,
	clipAt,
	findSounding,
	mapClip,
	mapTimeline,
	planFixes,
	projectFps,
	type Sounding,
	snapRanges,
	soundingClips,
	timelineSeams,
	type TimelineSeam,
	listenTo,
	mapPlaced,
	askClip,
	framesAt,
	type ModelState,
	wantHearingModel,
	fileOf,
	mediaSounding,
} from "@/hear/client";
import { playsLine } from "@/hear/music";
import { partOf, partTracks, soloPart, splitIntoParts } from "@/hear/parts";
import { songScore } from "@/hear/score-client";
import { scoreText } from "@/hear/score-text";
import { isSong, notesFor, type SongView } from "@/hear/song";
import { CONCEPTS } from "@/hear/ask";
import { type PicturePart, paintSound, reviewOf, sheetOf } from "@/hear/picture";
import { generateUUID } from "@/utils/id";
import { applyCuts, removeRangesFromTracks } from "@/silence/remove";
import type { SceneTracks, TimelineElement } from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";

type Args = Record<string, unknown>;
export interface Heard {
	text: string;
	images: string[];
}

const editor = () => EditorCore.getInstance();
const short = (id: string) => id.slice(0, 8);
const f2 = (v: number) => v.toFixed(2);
const fail = (message: string): never => {
	throw new Error(message);
};
/** Every clip on the timeline (any kind). */
const allClips = (): TimelineElement[] => {
	const t = editor().scenes.getActiveSceneOrNull()?.tracks;
	return t ? ([...t.overlay, t.main, ...t.audio] as Array<{ elements: TimelineElement[] }>).flatMap((x) => x.elements) : [];
};
const totalSeconds = () => editor().timeline.getTotalDuration() / TICKS_PER_SECOND;

// ───────────────────────── which sound: clips, Media files, a song's stems ─────────────────────────

/** A song's stem (separate_voice made it): its part, the song's name and media, and the other stem's clip beside it. */
export function stemOf(s: Sounding): { kind: "voice" | "music"; song: string; songId?: string; other?: Sounding } | null {
	const n = s.asset?.neural;
	if (n?.effect !== "ai.separate") return null;
	const kind = n.label === "Music" ? "music" : "voice";
	const songId = n.originalId ?? n.sourceId;
	const song = editor().media.getAssets().find((a) => a.id === songId);
	const other = soundingClips({ muted: true }).find((c) => c.element.id !== s.element.id && c.asset?.neural?.effect === "ai.separate" && (c.asset.neural.originalId ?? c.asset.neural.sourceId) === songId && (c.asset.neural.label === "Music") !== (kind === "music"));
	return { kind, song: song?.name ?? s.name.replace(/ · (voice|music)( .*)?$/i, ""), songId, other };
}

/** What a stem is, in one line: never judge the song's genre or instruments from it. */
function stemLine(st: NonNullable<ReturnType<typeof stemOf>>): string {
	const other = st.other ? ` (clip ${short(st.other.element.id)})` : "";
	return st.kind === "voice"
		? `Voice stem: no instruments — the singer alone, separated from «${st.song}». The song is this + its music stem${other} together. Genre, instruments and what plays when: analyze {what:"music"} on it (heard on the full mix).`
		: `Music stem: no voice — the band alone, separated from «${st.song}». The song is this + its voice stem${other} together. Genre and instruments: analyze {what:"music"} (heard on the full mix).`;
}

/** The song's own file (the full mix) placed like this clip when the clip is one of its stems; else the clip itself. */
export function fullMixOf(s: Sounding): Sounding {
	const st = stemOf(s);
	const song = st?.songId ? editor().media.getAssets().find((a) => a.id === st.songId && a.file) : undefined;
	if (!song) return s;
	// Sound is always separated from the whole file: the song plays at the same source times as its stem.
	const offset = s.asset?.neural?.offset ?? 0;
	return { ...mediaSounding(song, { start: s.start, trimStart: s.place.trimStart + offset, rate: s.place.rate }), end: s.end, element: s.element, track: s.track, name: song.name, ...(s.muted ? { muted: s.muted } : {}) };
}

/** A separation (separate_voice) running on the clip (or on any clip): the hearing waits for it — that sound is changing. */
async function waitSeparation(id: string | null, signal: AbortSignal): Promise<void> {
	const { separationsRunning } = await import("@/neural/apply");
	const running = separationsRunning(id ?? undefined);
	if (!running.length) return;
	await new Promise<void>((resolve, reject) => {
		const t = setTimeout(resolve, 10 * 60_000);
		const stop = () => {
			clearTimeout(t);
			reject(new DOMException("Aborted", "AbortError"));
		};
		signal.addEventListener("abort", stop, { once: true });
		void Promise.all(running).then(() => {
			clearTimeout(t);
			signal.removeEventListener("abort", stop);
			resolve();
		});
	});
}

/** A clip by id for the hearing: a timeline clip (a muted one too) or a Media sound / video (the cache is per file). */
async function targetClip(id: string, signal: AbortSignal): Promise<Sounding> {
	const key = String(id).trim();
	await waitSeparation(key, signal);
	return findSounding(key, { media: true }) ?? fail(`No clip with sound "${id}". get_project lists the ids (a clip with sound, or a Media sound / video).`);
}

class ReplaceTracksCommand extends Command {
	private before: SceneTracks | null = null;
	constructor(private readonly make: (tracks: SceneTracks) => SceneTracks) {
		super();
	}
	private after: SceneTracks | null = null;
	execute(): CommandResult | undefined {
		const ed = editor();
		this.before = ed.scenes.getActiveScene().tracks;
		this.after = this.make(this.before);
		ed.timeline.updateTracks(this.after);
		return undefined;
	}
	undo(): void {
		if (this.before) editor().timeline.updateTracks(this.before);
	}
	redo(): CommandResult | undefined {
		if (!this.after) return this.execute();
		editor().timeline.updateTracks(this.after);
		return undefined;
	}
}

/** Runs a tracks → tracks edit as one ⌘Z (ripple off: the edit moves what must move itself). */
export function replaceTracks(make: (tracks: SceneTracks) => SceneTracks) {
	const ed = editor();
	const ripple = ed.command.isRippleEnabled;
	ed.command.isRippleEnabled = false;
	try {
		ed.command.execute({ command: new BatchCommand([new ReplaceTracksCommand(make)]) });
	} finally {
		ed.command.isRippleEnabled = ripple;
	}
}

// ───────────────────────── words → text ─────────────────────────

const FIX_CALL: Record<string, string> = {
	noise: "noise",
	hum: "hum",
	mud: "mud",
	sibilance: "sibilance",
	echo: "echo",
	level: "level",
};

function noteLine(n: Note, id: string): string {
	const mark = n.severity >= 2 ? "⚠" : n.severity === 1 ? "·" : "✓";
	const fix = n.fix && n.severity >= 1 ? ` → fix_sound {"id":"${id}","what":"${FIX_CALL[n.fix] ?? n.fix}"}` : "";
	return `${mark} ${n.line}${fix}`;
}

function wordMark(w: ClipMap["words"][number]): string {
	return `${w.p !== undefined && w.p < 0.5 ? "?" : ""}${w.stress ? "!" : ""}${/[.!?…]["»”)]*$/.test(w.text) && (w.slope <= -1 || /[.!…]$/.test(w.text)) ? "↘" : ""}`;
}

/** The words as phrases (a new line at a pause ≥ 0.25 s or a sentence end), pauses between them, numbers #n. */
function wordLines(map: ClipMap, detail: boolean): string[] {
	const lines: string[] = [];
	const words = map.words;
	const pauseAfter = new Map(map.pauses.map((p) => [p.before, p]));
	let cur: string[] = [];
	let from = 0;
	const flush = (i: number) => {
		if (!cur.length) return;
		lines.push(`${f2(from)}–${f2(words[i].end)}  ${cur.join(" ")}`);
		cur = [];
	};
	const lead = pauseAfter.get(-1);
	if (lead && lead.length >= 0.25) lines.push(`   ‖ ${f2(lead.length)} s ${lead.kind}${lead.breath ? ` + breath ${f2(lead.breath.start)}–${f2(lead.breath.end)}` : ""} before the first word`);
	words.forEach((w, i) => {
		if (!cur.length) from = w.start;
		const n = map.first + i + 1;
		cur.push(detail ? `#${n} ${w.text}@${f2(w.start)}${wordMark(w)}` : cur.length ? `${w.text}${wordMark(w)}` : `#${n} ${w.text}${wordMark(w)}`);
		const p = pauseAfter.get(i);
		const sentence = /[.!?…]["»”)]*$/.test(w.text);
		if ((p && p.length >= 0.25) || sentence || cur.length >= (detail ? 12 : 18) || i === words.length - 1) {
			flush(i);
			if (p && p.length >= 0.25) lines.push(`   ‖ ${f2(p.length)} s ${p.kind}${p.breath ? ` + breath ${f2(p.breath.start)}–${f2(p.breath.end)}` : ""}`);
		}
	});
	return lines;
}

function musicLines(map: ClipMap): string[] {
	const g = map.grid;
	if (!g) return [];
	const period = g.beats.length > 1 ? (g.beats[g.beats.length - 1] - g.beats[0]) / (g.beats.length - 1) : 0;
	const bars = g.downbeats.slice(0, 24).map(f2).join(" ");
	const sections = g.sections.slice(0, 8).map((s) => `${f2(s.start)}–${f2(s.end)} (${Math.round(s.db)} dB)`).join(", ");
	return [`Music: ${Math.round(g.bpm)} BPM, a beat every ${period.toFixed(3)} s from ${g.beats[0] !== undefined ? f2(g.beats[0]) : "–"}; bars start at ${bars}${g.downbeats.length > 24 ? " …" : ""}${sections ? `; sections ${sections}` : ""}.`];
}

/** One plain sentence of what is heard, from the descriptors (for a quick read before the details). */
export function inWords(map: ClipMap, v: SongView = { song: false, sung: false, stem: null }): string {
	const note = (what: string) => map.notes.find((n) => n.what === what);
	const parts: string[] = [];
	const pitch = note("pitch")?.line.replace(/, median.*$/, "");
	const tone = note("tone")?.line.replace(/ \(.*$/, "");
	const pace = /\((fast|slow|normal)\)/.exec(note("pace")?.line ?? "")?.[1];
	const music = map.notes.find((n) => n.area === "music" && n.what === "character")?.line.replace(/ \(level.*$/, "");
	const kinds = new Set(map.segments.map((s) => s.kind));
	if (map.words.length >= 3) {
		// A song is sung, never «spoken»; the voice's range is only measured on a separated vocal.
		if (v.stem === "voice") parts.push(`the separated vocal: ${v.sung ? "a voice sings" : "a voice"}${pitch ? ` (${pitch.replace(/^(sung|voice): /, "").replace(/ \(measured.*$/, "")})` : ""}`);
		else if (v.song) parts.push(`singing over music${kinds.has("speech+music") || kinds.has("music") ? "" : " (vocals up front)"}`);
		else parts.push(`${pitch ? `a ${pitch.replace(/ voice/, " voice")}` : "a voice"} ${v.sung ? "sings" : "speaks"}${tone ? `, ${tone}` : ""}${pace && pace !== "normal" ? `, ${pace}` : ""}${kinds.has("speech+music") ? ", over music" : ""}`);
	}
	if (music && !map.words.length) parts.push(music);
	else if (music) parts.push(`music: ${music}`);
	const room = [note("echo")?.severity ? "an echoey room" : "", note("noise")?.severity ? "background noise" : "", note("hum") ? "mains hum" : ""].filter(Boolean);
	if (room.length) parts.push(`with ${room.join(" and ")}`);
	if (map.breaths.length) parts.push(`${map.breaths.length} breath${map.breaths.length > 1 ? "s" : ""} (${map.breaths.slice(0, 3).map((b) => `${b.start.toFixed(1)} s`).join(", ")})`);
	if (!map.words.length && !music) parts.push(kinds.has("noise") ? "noise / sounds, no speech" : kinds.has("silence") ? "mostly silence" : "room tone, no speech");
	const shape = map.notes.find((n) => n.what === "shape")?.line;
	if (shape) parts.push(shape);
	return parts.join("; ");
}

/** An AudioSet label as words in a sentence («Rain on surface» → «rain on surface»). */
const plainLabel = (l: string) => (/^[A-Z][a-z]/.test(l) ? l.charAt(0).toLowerCase() + l.slice(1) : l);

const heardAt = (map: ClipMap, seg: { start: number; end: number }) => map.heard?.find((h) => Math.abs(h.start - seg.start) < 0.011 && Math.abs(h.end - seg.end) < 0.011);

/** What the hearing model's tagger names in a stretch, without the label the stretch's kind already says. */
function namesIn(map: ClipMap, seg: { start: number; end: number; kind: string }): string | null {
	const tags = heardAt(map, seg)?.tags ?? [];
	const generic = seg.kind === "music" || seg.kind === "speech+music" ? /^(Music|Musical instrument)$/ : seg.kind === "speech" ? /^Speech$/ : /^$/;
	const names = tags.filter(([l]) => !generic.test(l)).slice(0, 3).map(([l]) => plainLabel(l));
	return names.length ? names.join(", ") : null;
}

/** Captions per stretch, in plain words: who or what is heard, and what happens there (breaths, clicks, holes). */
export function segmentCaptions(map: ClipMap, v: SongView = { song: false, sung: false, stem: null }): string[] {
	const pitch = map.notes.find((n) => n.what === "pitch")?.line.replace(/, median.*$/, "").replace(/ \(typical /, " (");
	const tone = map.notes.find((n) => n.what === "tone")?.line.replace(/ \(.*$/, "");
	const music = map.notes.find((n) => n.area === "music" && n.what === "character")?.line.replace(/ \(level.*$/, "");
	const out: string[] = [];
	for (const seg of map.segments) {
		if (seg.end - seg.start < 0.5) continue;
		const named = namesIn(map, seg);
		const h = heardAt(map, seg);
		// Words the recogniser guessed into rain or applause don't make it speech: the tagger hears no voice there.
		const voiceless = !!h && !h.speech && (h.tags[0]?.[1] ?? 0) >= 0.4 && (seg.kind === "speech" || seg.kind === "speech+music");
		const what = voiceless
			? (named ?? "no voice")
			: v.song && (seg.kind === "speech" || seg.kind === "speech+music")
				? `vocals${seg.kind === "speech+music" ? " over music" : ""}${named ? ` (heard: ${named})` : ""}`
				: seg.kind === "speech"
				? `${pitch ? `a ${pitch}` : "a voice"} ${v.sung ? "sings" : "speaks"}${tone && !v.sung ? `, ${tone.split(",")[0]}` : ""}${named ? ` (heard: ${named})` : ""}`
				: seg.kind === "speech+music"
					? `${pitch ? `a ${pitch}` : "a voice"} over ${named ? `music (${named})` : "music"}`
					: seg.kind === "music"
						? named
							? `music: ${named}${music ? ` — ${music}` : ""}`
							: (music ?? "music")
						: seg.kind === "room"
							? named
								? `room tone (${named})`
								: "room tone"
							: seg.kind === "silence"
								? "silence"
								: (named ?? "noise, no speech");
		const events = [
			...map.breaths.filter((b) => b.start >= seg.start && b.start < seg.end).map((b) => `a breath at ${b.start.toFixed(1)} s`),
			...map.clicks.filter((c) => c.at >= seg.start && c.at < seg.end).map((c) => `a click at ${c.at.toFixed(2)} s`),
			...map.holes.filter((h) => h.start >= seg.start && h.start < seg.end).map((h) => `a dropout at ${h.start.toFixed(2)} s`),
		];
		out.push(`${seg.start.toFixed(1)}–${seg.end.toFixed(1)} ${what}${events.length ? ` (${events.slice(0, 3).join(", ")})` : ""}`);
	}
	return out.slice(0, 14);
}

/** How the hearing should read this clip: a song (sung, mastered), a stem of one, or a voice. */
export function songView(clip: Sounding, map: ClipMap): SongView {
	return isSong({ library: clip.music, stem: stemOf(clip)?.kind ?? null, heardAll: map.heardAll, segments: map.segments, from: map.from, to: map.to, pulse: map.grid?.pulse, words: map.words.length });
}

/** One clip's map as compact text: problems with fixes first, then cut points, then the words. */
export function formatClipMap(clip: Sounding, map: ClipMap): string {
	const id = short(clip.element.id);
	const out: string[] = [];
	const v = songView(clip, map);
	const stem = stemOf(clip);
	const kind = stem ? `${stem.kind} stem of «${stem.song}»` : clip.music ? "music" : clip.sfx ? "sound effect" : v.song ? "song" : "sound";
	out.push(`«${clip.name}» (${kind}, ${clip.mediaOnly ? "media" : "clip"} ${id}) ${f2(map.from)}–${f2(map.to)} s · ${map.loud.integrated} LUFS, peak ${map.loud.peakDb.toFixed(1)} dBFS${map.words.length ? ` · ${map.words.length} words${v.song || v.sung ? "" : `, natural pause ${map.rhythm.pause.toFixed(2)} s`}` : ""}`);
	if (stem) out.push(stemLine(stem));
	if (clip.muted) out.push(`Not heard in the mix: ${clip.muted} — heard here from its file.`);
	if (clip.mediaOnly) out.push("In Media, not on the timeline: the times are the file's own seconds.");
	map = { ...map, notes: notesFor(map.notes, v, map.words.length) };
	const said = inWords(map, v);
	if (said) out.push(`In words: ${said}.`);
	if (map.heardAll?.length) out.push(`Heard (AudioSet tagger on this Mac): ${map.heardAll.map(([l, p]) => `${l} ${Math.round(p * 100)}%`).join(" · ")}`);
	if (v.song && !stem) out.push(`A song: genre, instruments and what plays when → analyze {what:"music", id:"${id}"} (heard on the full mix).`);
	const caps = segmentCaptions(map, v);
	if (caps.length > 1 || (caps.length && map.heard?.length)) out.push(`Captions: ${caps.join("; ")}`);
	const problems = map.notes.filter((n) => n.severity >= 1);
	const spots: string[] = [];
	if (map.clicks.length) spots.push(`click${map.clicks.length > 1 ? "s" : ""} at ${map.clicks.slice(0, 5).map((c) => `${f2(c.at)} s (+${c.over} dB)`).join(", ")}`);
	if (map.holes.length) spots.push(`digital-silence hole${map.holes.length > 1 ? "s" : ""} ${map.holes.slice(0, 4).map((h) => `${f2(h.start)}–${f2(h.end)}`).join(", ")}`);
	if (problems.length || spots.length) {
		out.push("Problems → fixes:");
		for (const n of problems) out.push(` ${noteLine(n, id)}`);
		for (const s of spots) out.push(` ⚠ ${s} → cut it out (cut_out) or check_cuts {"fix":true} if it sits at a cut`);
	}
	const good = map.notes.filter((n) => n.severity === 0).map((n) => n.line);
	if (good.length) out.push(`How it sounds: ${good.join(" · ")}`);
	if (map.cuts.length) out.push(`Best cuts (frame-exact, best first): ${map.cuts.slice(0, 8).map((c) => `${c.at.toFixed(3)}${"★".repeat(c.stars)} ${c.after >= 0 ? `after #${map.first + c.after + 1}` : "start"} (${c.reason})`).join(" · ")}`);
	const segs = map.segments.filter((s) => s.end - s.start >= 0.3);
	if (segs.length > 1 || (segs[0] && segs[0].kind !== "speech")) out.push(`Stretches: ${segs.slice(0, 16).map((s) => `${s.start.toFixed(1)}–${s.end.toFixed(1)} ${s.kind}`).join(" · ")}${segs.length > 16 ? " …" : ""}`);
	out.push(...musicLines(map));
	if (map.words.length) {
		const detail = map.words.length <= 350;
		out.push(detail ? "Words (#n word@start · ? unsure · ! stressed · ↘ sentence end) and pauses ‖:" : "Words by phrase (#n of each line's first word; listen with from/to for word times):");
		out.push(...wordLines(map, detail));
		const quotes = map.sentences.filter((s) => s.complete && s.last > s.first).sort((a, b) => b.stress + b.pauseAfter * 2 - (a.stress + a.pauseAfter * 2)).slice(0, 5);
		if (quotes.length) out.push(`Whole sentences (quote candidates): ${quotes.map((q) => `#${map.first + q.first + 1}–${map.first + q.last + 1} ${f2(q.start)}–${f2(q.end)} (${q.stress} stressed, pause after ${q.pauseAfter.toFixed(2)} s${q.falling ? ", ends falling" : ""})`).join(" · ")}`);
		if (map.fillerShare > 0.01 || map.deadAir > 0.02) out.push(`Fillers ${Math.round(map.fillerShare * 100)}% of words · dead air ${Math.round(map.deadAir * 100)}% (remove_pauses takes both out, keeping ~${map.rhythm.pause.toFixed(2)} s pauses)`);
	}
	return out.join("\n");
}

/** How the clips sound together: music masking the voice, effects too loud, level jumps between neighbours. */
export function mixLines(list: Array<{ clip: Sounding; map: ClipMap }>): string[] {
	const out: string[] = [];
	const level = (x: { clip: Sounding; map: ClipMap }) => x.map.loud.integrated + x.clip.gainDb;
	// Music: a library track, or any sound that is mostly music and has no words of its own.
	const musicShare = (m: ClipMap) => m.segments.filter((s) => s.kind === "music").reduce((a, s) => a + s.end - s.start, 0) / Math.max(0.1, m.to - m.from);
	const isMusic = (x: { clip: Sounding; map: ClipMap }) => x.clip.music || (!x.clip.sfx && x.map.words.length < 3 && (!!x.map.grid || musicShare(x.map) >= 0.5));
	const voices = list.filter((x) => !isMusic(x) && !x.clip.sfx && x.map.words.length >= 3);
	const songOf = (x: { clip: Sounding }) => {
		const n = x.clip.asset?.neural;
		return n?.effect === "ai.separate" ? (n.originalId ?? n.sourceId) : null;
	};
	for (const m of list.filter(isMusic)) {
		for (const v of voices) {
			// A song's voice stem over its own music stem is the song as mixed, not music masking a voice.
			if (songOf(m) && songOf(m) === songOf(v)) continue;
			const lo = Math.max(m.clip.start, v.clip.start);
			const hi = Math.min(m.clip.end, v.clip.end);
			if (hi - lo < 1) continue;
			const duck = ((m.clip.element.params ?? {}) as Record<string, unknown>).duckUnderVoice === true ? -12 : 0;
			const under = level(v) - (level(m) + duck);
			if (under < 12) {
				const id = short(m.clip.element.id);
				out.push(`⚠ music «${m.clip.name}» is only ${Math.round(under)} dB under the voice «${v.clip.name}» (${f2(lo)}–${f2(hi)}): it masks words; keep it ≥ 12 dB under → ${duck ? `fix_sound {"id":"${id}","what":"quieter","db":${Math.ceil(12 - under)}}` : `fix_sound {"id":"${id}","what":"duck"}`}`);
			}
		}
	}
	const speech = voices.length ? Math.max(...voices.map(level)) : null;
	for (const e of list.filter((x) => x.clip.sfx)) {
		if (speech !== null && level(e) > speech + 6) out.push(`⚠ sound effect «${e.clip.name}» at ${f2(e.clip.start)} s is ${Math.round(level(e) - speech)} dB over the voice → fix_sound {"id":"${short(e.clip.element.id)}","what":"quieter","db":${Math.ceil(level(e) - speech)}}`);
	}
	const byTrack = new Map<string, Array<{ clip: Sounding; map: ClipMap }>>();
	for (const x of list) byTrack.set(x.clip.track.id, [...(byTrack.get(x.clip.track.id) ?? []), x]);
	for (const items of byTrack.values()) {
		items.sort((a, b) => a.clip.start - b.clip.start);
		for (let i = 1; i < items.length; i++) {
			const a = items[i - 1];
			const b = items[i];
			if (b.clip.start - a.clip.end > 0.5 || isMusic(a) || isMusic(b)) continue;
			const jump = level(b) - level(a);
			if (Math.abs(jump) >= 6 && a.map.loud.integrated > -60 && b.map.loud.integrated > -60) out.push(`⚠ level jumps ${jump > 0 ? "up" : "down"} ${Math.round(Math.abs(jump))} LU at ${f2(b.clip.start)} s («${a.clip.name}» → «${b.clip.name}») → fix_sound {"id":"${short(b.clip.element.id)}","what":"${jump > 0 ? "quieter" : "louder"}","db":${Math.round(Math.abs(jump))}}`);
		}
	}
	return out;
}

// ───────────────────────── listen ─────────────────────────

async function pictureOf(list: Array<{ clip: Sounding; map: ClipMap }>, from: number, to: number, signal: AbortSignal): Promise<string> {
	const span = Math.min(60, to - from);
	const end = from + span;
	const parts: PicturePart[] = [];
	for (const { clip } of list) {
		const a = Math.max(from, clip.start);
		const b = Math.min(end, clip.end);
		if (b - a < 0.02) continue;
		const { fileId } = await listenTo(clip, signal);
		const rate = clip.place.rate || 1;
		parts.push({ fileId, sourceFrom: clip.place.trimStart + (a - clip.start) * rate, sourceLength: (b - a) * rate, from: a, to: b });
	}
	const words = span <= 40 ? list.flatMap(({ map }) => map.words.map((w, i) => ({ start: w.start, end: w.end, text: w.text, n: map.first + i + 1, stress: w.stress }))).filter((w) => w.end > from && w.start < end) : [];
	const cuts = timelineSeams({ from, to: end }).map((s) => s.at);
	return paintSound(from, end, parts, {
		words,
		pauses: list.flatMap(({ map }) => map.pauses.filter((p) => p.length >= 0.15)),
		breaths: list.flatMap(({ map }) => map.breaths),
		beats: list.flatMap(({ map }) => map.grid?.beats ?? []),
		downbeats: list.flatMap(({ map }) => map.grid?.downbeats ?? []),
		cuts,
		points: list.flatMap(({ map }) => map.cuts.slice(0, 8).map((c) => c.at)),
		bad: list.flatMap(({ map }) => [...map.clicks.map((c) => c.at), ...map.holes.map((h) => h.start)]),
	}, { width: 900, signal });
}

/** listen {id? | from,to, picture?}: the audio map as text (+ one small picture). */
export async function listen(args: Args, signal: AbortSignal): Promise<Heard | string> {
	const end = totalSeconds();
	if (end <= 0) return "The timeline is empty: nothing to hear.";
	let list: Array<{ clip: Sounding; map: ClipMap }>;
	let from: number;
	let to: number;
	let muted: Sounding[] = [];
	if (args.id) {
		const clip = await targetClip(String(args.id), signal);
		from = Math.max(clip.start, Number(args.from ?? clip.start));
		to = Math.min(clip.end, Number(args.to ?? clip.end), from + 600);
		list = [{ clip, map: await mapClip(clip, { from, to }, { signal, captions: true }) }];
	} else {
		await waitSeparation(null, signal);
		from = Math.max(0, Number(args.from ?? 0) || 0);
		to = Math.min(end, Number(args.to ?? end) || end, from + 600);
		list = await mapTimeline(from, to, signal, { captions: true });
		muted = soundingClips({ muted: true }).filter((c) => c.muted && c.end > from + 0.05 && c.start < to - 0.05);
	}
	const mutedLine = muted.length ? `Muted, not in the mix (listen {id} hears them): ${muted.slice(0, 6).map((c) => `«${c.name}» (clip ${short(c.element.id)}, ${c.muted})`).join(", ")}.` : "";
	if (!list.length) return `Nothing sounds in ${f2(from)}–${f2(to)} s (no clip with sound there).${mutedLine ? ` ${mutedLine}` : ""}`;
	const text: string[] = [`Heard ${f2(from)}–${f2(to)} s on the timeline (timeline seconds, ${Math.round(projectFps())} fps):`];
	if (to - from >= 599.9 && (args.to === undefined || Number(args.to) > to)) text.push(`(at most 10 minutes per call: listen again from ${f2(to)} s for the rest)`);
	for (const x of list) text.push("", formatClipMap(x.clip, x.map));
	if (mutedLine) text.push("", mutedLine);
	const mix = mixLines(list);
	if (mix.length) text.push("", "The mix:", ...mix);
	const cuts = timelineSeams({ from, to });
	if (cuts.length) text.push("", `Cuts on the timeline here: ${cuts.slice(0, 20).map((c) => f2(c.at)).join(", ")}${cuts.length > 20 ? " …" : ""} — check_cuts checks them by ear.`);
	const note = list.find((x) => x.map.note)?.map;
	if (note) {
		wantHearingModel(note.model);
		text.push("", `(No names for the sounds yet: ${note.note}.)`);
	}
	if (!args.picture) return text.join("\n");
	const image = await pictureOf(list, from, to, signal);
	text.push("", `Picture: ${f2(from)}–${f2(Math.min(to, from + 60))} s — waveform (top) over the spectrogram (60 Hz bottom … 12 kHz top), words under it; blue bands = pauses, orange = breaths, purple ticks = beats (tall = bar starts), white dashes = cuts on the timeline, green = best cut points, red = clicks/holes.`);
	return { text: text.join("\n"), images: [image] };
}

// ───────────────────────── cut_point ─────────────────────────

export async function cutPoint(args: Args, signal: AbortSignal): Promise<string> {
	const at = args.at !== undefined ? Number(args.at) : undefined;
	let clip: Sounding | null = null;
	let note = "";
	if (args.id) {
		// A clip with no sound of its own (a picture, a muted AI video): the sound under it at `at` decides the cut —
		// the song of a music video (10.11: «No clip with sound» nine times on a music video's shots).
		const own = findSounding(String(args.id), { media: true });
		const picture = !own && at !== undefined ? allClips().find((e) => e.id === String(args.id) || e.id.startsWith(String(args.id))) : undefined;
		if (picture && at !== undefined) {
			clip = clipAt(at, soundingClips({ muted: true }));
			if (clip) note = `Clip ${short(picture.id)} has no sound of its own: cut on «${clip.name}» under it. `;
		} else clip = await targetClip(String(args.id), signal);
	} else if (at !== undefined) clip = clipAt(at);
	if (!clip) return at !== undefined ? `No sound at ${f2(at)} s: any frame boundary is fine (${(Math.round(at * projectFps()) / projectFps()).toFixed(3)} s).` : fail("Give `at` (timeline seconds), or `id` with `after` (word #n from listen).");
	if (args.after === undefined && at === undefined) fail("Give `at` or `after`.");
	const r = await cutPointsAt(clip, { at, after: args.after !== undefined ? Number(args.after) : undefined, window: args.window !== undefined ? Number(args.window) : undefined, music: !!args.music || clip.music }, signal);
	const best = r.points[0];
	const fps = projectFps();
	if (!best) return `${note}No pause near ${f2(r.at)} s in «${clip.name}»: the words run on. The nearest frame is ${(Math.round(r.at * fps) / fps).toFixed(3)} s; cut_out/split keep words whole there anyway.`;
	const frame = Math.round(best.at * fps);
	const other = r.points.slice(1).map((p) => `${p.at.toFixed(3)}${"★".repeat(p.stars)} (${p.reason})`);
	return `${note}Cut at ${best.at.toFixed(3)} s (frame ${frame} at ${Math.round(fps)} fps)${"★".repeat(best.stars)}: ${best.reason}${best.pause ? ` — pause ${f2(best.pause.start)}–${f2(best.pause.end)}` : ""}, level there ${Math.round(best.db)} dB.${r.words ? ` Between «${r.words[0]}» and «${r.words[1] ?? "the end"}».` : ""}${other.length ? ` Also good: ${other.join(", ")}.` : ""}`;
}

// ───────────────────────── check_cuts ─────────────────────────


/**
 * The review picture of one cut (claude-produce's review uses it too): six preview frames around it (−1.2, −0.5 s, the
 * last frame before, the first after, +0.5, +1.2 s) over the waveform/spectrogram strip of ±1.5 s, the cut dashed.
 */
export async function cutReview(at: number, signal: AbortSignal, label = ""): Promise<string> {
	const fps = projectFps();
	const end = totalSeconds();
	const from = Math.max(0, at - 1.5);
	const to = Math.min(end, at + 1.5);
	const parts: PicturePart[] = [];
	const clips = soundingClips().filter((s) => s.end > from && s.start < to);
	for (const s of clips) {
		const a = Math.max(from, s.start);
		const b = Math.min(to, s.end);
		if (b - a < 0.02) continue;
		const { fileId } = await listenTo(s, signal);
		const rate = s.place.rate || 1;
		parts.push({ fileId, sourceFrom: s.place.trimStart + (a - s.start) * rate, sourceLength: (b - a) * rate, from: a, to: b });
	}
	const maps = await Promise.all(clips.map((s) => mapClip(s, { from, to }, { signal }).catch(() => null)));
	const strip = await paintSound(from, to, parts, { words: maps.flatMap((m) => m?.words.map((w) => ({ start: w.start, end: w.end, text: w.text })) ?? []), breaths: maps.flatMap((m) => m?.breaths ?? []), cuts: [at], bad: [at] }, { width: 720, compact: true, signal });
	const times = [at - 1.2, at - 0.5, at - 1 / fps, at + 0.001, at + 0.5, at + 1.2].map((t) => Math.max(0, Math.min(end - 0.04, t)));
	// Frames decoded on the server from the clips' own files, laid out by the paint worker: no preview seeks, no
	// canvas on the main thread.
	const shots = await framesAt(times, 160, signal).catch(() => times.map(() => null));
	return reviewOf(label || `cut at ${at.toFixed(2)} s`, times, shots, strip, 720);
}

async function seamPictures(seams: Array<{ seam: TimelineSeam; label: string }>, signal: AbortSignal): Promise<string | null> {
	// Up to three bad cuts, each as frames around it over its sound, stacked into one picture.
	const shots: Array<{ src: string; label: string }> = [];
	for (const { seam, label } of seams.slice(0, 3)) shots.push({ src: await cutReview(seam.at, signal, label), label: "" });
	if (shots.length) return sheetOf(shots, 1);
	return seamWaves(seams, signal);
}

async function seamWaves(seams: Array<{ seam: TimelineSeam; label: string }>, signal: AbortSignal): Promise<string | null> {
	const shots: Array<{ src: string; label: string }> = [];
	for (const { seam, label } of seams.slice(0, 4)) {
		const from = seam.at - 0.6;
		const to = seam.at + 0.6;
		const parts: PicturePart[] = [];
		for (const s of [seam.left, seam.right]) {
			if (!s) continue;
			const a = Math.max(from, s.start);
			const b = Math.min(to, s.end);
			if (b - a < 0.02) continue;
			const { fileId } = await listenTo(s, signal);
			const rate = s.place.rate || 1;
			parts.push({ fileId, sourceFrom: s.place.trimStart + (a - s.start) * rate, sourceLength: (b - a) * rate, from: a, to: b });
		}
		const maps = await Promise.all([seam.left, seam.right].filter((s): s is Sounding => !!s).map((s) => mapClip(s, { from, to }, { signal }).then((m) => ({ s, m }))));
		const src = await paintSound(from, to, parts, { words: maps.flatMap(({ m }) => m.words.map((w) => ({ start: w.start, end: w.end, text: w.text }))), breaths: maps.flatMap(({ m }) => m.breaths), cuts: [seam.at], bad: [seam.at] }, { width: 420, compact: true, signal });
		shots.push({ src, label });
	}
	return shots.length ? sheetOf(shots, 2) : null;
}

function cutName(seam: TimelineSeam): string {
	const l = seam.left ? `«${seam.left.name}» ${short(seam.left.element.id)}` : "silence";
	const r = seam.right ? `«${seam.right.name}» ${short(seam.right.element.id)}` : "silence";
	return `${l} → ${r}`;
}

function fixWords(fix: { op: string; seconds?: number; db?: number; why?: string }, fps: number): string {
	const n = fix.seconds !== undefined ? Math.max(1, Math.round(Math.abs(fix.seconds) * fps)) : 0;
	switch (fix.op) {
		case "fade":
			return `${Math.round((fix.seconds ?? 0.01) * 1000)} ms audio fades on both sides`;
		case "extendLeft":
			return `extend the left clip ${n} frame${n > 1 ? "s" : ""}`;
		case "trimLeft":
			return `trim ${n} frame${n > 1 ? "s" : ""} off the left clip's end`;
		case "extendRight":
			return `extend the right clip ${n} frame${n > 1 ? "s" : ""} at its start`;
		case "trimRight":
			return `trim ${n} frame${n > 1 ? "s" : ""} off the right clip's start`;
		case "roll":
			return `move the cut ${(fix.seconds ?? 0) > 0 ? "+" : "−"}${n} frame${n > 1 ? "s" : ""} onto the beat`;
		case "fillGap":
			return "fill the gap with the left clip's own room tone";
		case "gain":
			return `right clip ${(fix.db ?? 0) > 0 ? "+" : ""}${fix.db} dB`;
		default:
			return fix.why ?? "nothing the app can do";
	}
}

/** check_cuts {ids?, from?, to?, fix?}: every audio cut checked by ear; fix:true repairs them (one ⌘Z) and checks again. */
export async function checkCuts(args: Args, signal: AbortSignal): Promise<Heard | string> {
	const ids = Array.isArray(args.ids) ? args.ids.map(String) : typeof args.ids === "string" ? String(args.ids).split(/[\s,]+/).filter(Boolean) : undefined;
	const range = { ids, from: args.from !== undefined ? Number(args.from) : undefined, to: args.to !== undefined ? Number(args.to) : undefined };
	const seams = timelineSeams(range);
	if (!seams.length) return "No audio cuts here: every sound runs unbroken (or there is no sound).";
	const fps = projectFps();
	const reports = await checkSeams(seams, signal);
	const bad = reports.filter((r) => r.defects.length);
	const lines: string[] = [`${seams.length} audio cut${seams.length > 1 ? "s" : ""} checked: ${bad.length ? `${bad.length} with problems` : "all clean"}.`];
	const seamOf = (at: number) => seams.find((s) => Math.abs(s.at - at) < 1e-3) as TimelineSeam;
	for (const r of reports) {
		const s = seamOf(r.at);
		if (!r.defects.length) {
			lines.push(`✓ ${f2(r.at)} s ${cutName(s)}: clean${r.pause !== undefined ? ` (pause ${r.pause.toFixed(2)} s, speaker's ${r.natural?.toFixed(2)} s)` : ""}`);
			continue;
		}
		lines.push(`✗ ${f2(r.at)} s ${cutName(s)}: ${r.defects.map((d) => `${d.detail} → ${fixWords(d.fix, fps)}`).join("; ")}`);
	}
	if (!bad.length) return lines.join("\n");
	if (!args.fix) {
		lines.push(`Call check_cuts {"fix":true${ids ? `,"ids":${JSON.stringify(ids)}` : ""}} to apply these fixes (one ⌘Z), or fix by hand.`);
		const pic = await seamPictures(bad.map((r) => ({ seam: seamOf(r.at), label: `${f2(r.at)} s: ${r.defects[0].detail}` })), signal).catch(() => null);
		if (pic) lines.push("Picture: 1.2 s around each bad cut (dashed white = the cut).");
		return pic ? { text: lines.join("\n"), images: [pic] } : lines.join("\n");
	}
	let result: ReturnType<typeof planFixes> | null = null;
	replaceTracks((tracks) => {
		result = planFixes(tracks, reports, seams, fps, (t, ranges, tps, fade) => removeRangesFromTracks(t, ranges.map((x) => ({ start: x.start * tps, end: x.end * tps })), tps, fade));
		return (result as ReturnType<typeof planFixes>).tracks;
	});
	const applied = result as ReturnType<typeof planFixes> | null;
	const fixed = applied?.done ?? [];
	lines.push("", `Fixed ${fixed.length} cut${fixed.length === 1 ? "" : "s"} (one ⌘Z):`, ...fixed.map((d) => `• ${f2(d.at)} s: ${d.did}`));
	if (applied?.skipped.length) lines.push(...applied.skipped.map((s) => `• not fixable: ${s}`));
	// Listen again.
	const again = await checkSeams(timelineSeams(range), signal);
	const left = again.filter((r) => r.defects.some((d) => d.severity >= 2));
	lines.push(left.length ? `Checked again: ${left.length} still need a look: ${left.map((r) => `${f2(r.at)} s ${r.defects.map((d) => d.detail).join("; ")}`).join(" | ")}` : `Checked again: all ${again.length} cuts clean.`);
	return lines.join("\n");
}

// ───────────────────────── fix_sound ─────────────────────────

const HUM_BANDS = (f: number) => [{ type: "highpass", f: 70, g: 0, q: 0.71 }, ...[1, 2, 3, 4].map((h) => ({ type: "peak", f: f * h, g: -24, q: 12 }))].slice(0, 6);

/** fix_sound {id, what, db?}: the app's own audio effects for what listen found (one ⌘Z). */
export function fixSound(args: Args): string {
	const clip = findSounding(String(args.id ?? "")) ?? fail(`No clip with sound "${args.id}".`);
	const what = String(args.what ?? "");
	const el = clip.element as TimelineElement;
	const params = { ...((el.params ?? {}) as Record<string, unknown>) };
	let did = "";
	switch (what) {
		case "noise":
			Object.assign(params, { "fx.denoise": true, "fx.denoise.amount": 12, "fx.denoise.floor": -40 });
			did = "Reduce noise on (12 dB)";
			break;
		case "hum": {
			const f = Number(args.hz) === 60 ? 60 : 50;
			Object.assign(params, { "fx.voice": true, "fx.voice.bands": JSON.stringify(HUM_BANDS(f)) });
			did = `EQ: notches at ${f}, ${f * 2}, ${f * 3}, ${f * 4} Hz and a 70 Hz high-pass`;
			break;
		}
		case "mud":
			Object.assign(params, { "fx.voice": true, "fx.voice.bands": JSON.stringify([{ type: "highpass", f: 80, g: 0, q: 0.71 }, { type: "peak", f: 220, g: -5, q: 1 }, { type: "peak", f: 3200, g: 1.5, q: 0.9 }]) });
			did = "EQ: −5 dB at 220 Hz, 80 Hz high-pass, a little presence";
			break;
		case "sibilance":
			Object.assign(params, { "fx.deesser": true, "fx.deesser.amount": 60 });
			did = "De-esser on (60 %)";
			break;
		case "echo":
			Object.assign(params, { "fx.isolate": true });
			did = "Isolate voice on (takes the room and noise out)";
			break;
		case "level":
			Object.assign(params, { "fx.compressor": true, "fx.compressor.threshold": -18, "fx.compressor.ratio": 3, "fx.compressor.attack": 10, "fx.compressor.release": 120, "fx.compressor.knee": 2.8, "fx.compressor.makeup": 2 });
			did = "Compressor (voice preset) on";
			break;
		case "duck":
			params.duckUnderVoice = true;
			did = "ducks −12 dB under the voice";
			break;
		case "quieter":
		case "louder": {
			const db = Math.abs(Number(args.db) || 3) * (what === "quieter" ? -1 : 1);
			const v = typeof params.volume === "number" ? params.volume : 0;
			params.volume = Math.round(Math.max(-40, Math.min(12, v + db)) * 10) / 10;
			did = `volume ${v} → ${params.volume} dB`;
			break;
		}
		default:
			fail("what: noise | hum | mud | sibilance | echo | level | duck | quieter | louder");
	}
	editor().timeline.updateElements({ updates: [{ trackId: clip.track.id, elementId: el.id, patch: { params } as Partial<TimelineElement> }] });
	return `«${clip.name}»: ${did}. The effect renders on this Mac in a moment; listen again to check.`;
}

// ───────────────────────── the seamless editing tools ─────────────────────────

/** transcript: what is said, as numbered phrases with timeline times, per clip (cached per file: instant after edits). */
export async function hearTranscript(args: Args, signal: AbortSignal): Promise<string> {
	let list: Array<{ clip: Sounding; map: ClipMap }>;
	// from / to (timeline seconds) narrow it down; outside the clip they are clamped to it.
	const lo = args.from !== undefined && Number.isFinite(Number(args.from)) ? Number(args.from) : undefined;
	const hi = args.to !== undefined && Number.isFinite(Number(args.to)) ? Number(args.to) : undefined;
	const range = lo !== undefined || hi !== undefined ? { from: lo, to: hi } : undefined;
	if (args.id) {
		const clip = await targetClip(String(args.id), signal);
		list = [{ clip, map: await mapClip(clip, range, { signal }) }];
	} else {
		await waitSeparation(null, signal);
		const clips = soundingClips().filter((s) => !s.music && !s.sfx && (!range || (s.end > (lo ?? -Infinity) && s.start < (hi ?? Infinity))));
		list = [];
		for (const clip of clips) list.push({ clip, map: await mapClip(clip, range, { signal }) });
	}
	const speaking = list.filter((x) => x.map.words.length);
	// Muted clips aren't in the mix: a whole-timeline transcript names them (an id hears them from their file).
	const mutedNote = args.id ? "" : (() => {
		const m = soundingClips({ muted: true }).filter((c) => c.muted && !c.music && !c.sfx && (!range || (c.end > (lo ?? -Infinity) && c.start < (hi ?? Infinity))));
		return m.length ? `Muted, not in the mix (analyze {what:"words", id} hears them): ${m.slice(0, 6).map((c) => `«${c.name}» (clip ${short(c.element.id)}, ${c.muted})`).join(", ")}.` : "";
	})();
	if (!speaking.length) return `${range ? `No speech found in ${f2(lo ?? 0)}–${hi !== undefined ? f2(hi) : "the end"} s.` : "No speech found."}${mutedNote ? ` ${mutedNote}` : ""}`;
	const many = speaking.length > 1;
	const lines: Array<{ t: number; s: string }> = [];
	for (const { clip, map } of speaking) {
		let cur: number[] = [];
		const flush = () => {
			if (!cur.length) return;
			const ws = cur.map((i) => map.words[i]);
			const text = ws.map((w) => w.text).join(" ").replace(/\s+([,.!?…])/g, "$1");
			lines.push({ t: ws[0].start, s: `[${f2(ws[0].start)}–${f2(ws[ws.length - 1].end)}] ${many ? `(${short(clip.element.id)}) ` : ""}#${map.first + cur[0] + 1} ${text}` });
			cur = [];
		};
		map.words.forEach((w, i) => {
			const prev = map.words[cur[cur.length - 1]];
			if (cur.length && (w.start - prev.end > 0.45 || /[.!?…]$/.test(prev.text) || cur.length >= 14)) flush();
			cur.push(i);
		});
		flush();
	}
	lines.sort((a, b) => a.t - b.t);
	const language = speaking[0].map.language;
	const where = range ? ` ${f2(Math.max(...speaking.map((x) => x.map.from)))}–${f2(Math.min(...speaking.map((x) => x.map.to)))} s only` : "";
	const notes = speaking.flatMap(({ clip }) => [clip.muted ? `«${clip.name}»: ${clip.muted} (heard from its file)` : "", clip.mediaOnly ? `«${clip.name}» is in Media, not on the timeline: the file's own seconds` : "", stemOf(clip)?.kind === "voice" ? `«${clip.name}» is the voice stem of «${stemOf(clip)?.song}»: sung lines` : ""]).filter(Boolean);
	if (mutedNote) notes.push(mutedNote);
	return `Speech (${language}),${where} timeline seconds, #n = word number in its clip (cut_point {after:n} / listen use them):${notes.length ? `\n(${notes.join("; ")})` : ""}\n${lines.map((l) => l.s).join("\n")}\nA line said again later is a retake: keep the last complete one, cut the earlier tries, false starts and stumbles (cut_out keeps every word it doesn't remove whole and the speaker's pause at the join).`;
}

/** cut_out: the ranges made seamless (words whole, natural pause at the join, frame-exact, 10 ms fades), then cut. */
export async function cutOutSeamless(args: Args, signal: AbortSignal): Promise<string> {
	const raw = Array.isArray(args.ranges) ? (args.ranges as Array<{ from?: unknown; to?: unknown }>) : [];
	const end = totalSeconds();
	const fps = projectFps();
	const ranges = raw
		.map((r) => ({ from: Math.max(0, Number(r.from)), to: Math.min(end, Number(r.to)) }))
		.filter((r) => Number.isFinite(r.from) && Number.isFinite(r.to) && r.to - r.from >= 0.05)
		.sort((a, b) => a.from - b.from);
	if (!ranges.length) fail("Give the ranges to cut out: [{from, to}] in timeline seconds.");
	const snapped = args.exact ? ranges.map((r) => ({ from: Math.round(r.from * fps) / fps, to: Math.round(r.to * fps) / fps, notes: [] as string[] })) : await snapRanges(ranges, signal);
	const merged: Array<{ start: number; end: number }> = [];
	for (const r of [...snapped].sort((a, b) => a.from - b.from)) {
		const last = merged[merged.length - 1];
		if (last && r.from <= last.end + 1e-6) last.end = Math.max(last.end, r.to);
		else if (r.to - r.from >= 1 / fps - 1e-6) merged.push({ start: r.from, end: r.to });
	}
	if (!merged.length) fail("Nothing left to cut after keeping the words whole: the ranges were inside words.");
	applyCuts(editor(), merged, TICKS_PER_SECOND, args.exact ? 0 : SEAM_FADE);
	const total = merged.reduce((s, r) => s + r.end - r.start, 0);
	const notes = snapped.flatMap((s) => s.notes);
	// The new joins, listened to at once.
	let removed = 0;
	const joins = merged.map((r) => {
		const t = r.start - removed;
		removed += r.end - r.start;
		return t;
	});
	const seams = timelineSeams().filter((s) => joins.some((j) => Math.abs(j - s.at) < 1.5 / fps));
	const reports = seams.length ? await checkSeams(seams, signal).catch(() => []) : [];
	const badJoins = reports.filter((r) => r.defects.some((d) => d.severity >= 2));
	return [
		`Cut out ${merged.length} piece${merged.length === 1 ? "" : "s"} (${total.toFixed(2)} s); everything after moved back, all tracks together.`,
		args.exact ? "Exact: the ranges as given (frame-rounded)." : `Seamless: edges in the pauses, words whole, frame-exact, ${Math.round(SEAM_FADE * 1000)} ms audio fades at each join.`,
		notes.length ? `Moved: ${notes.join("; ")}.` : "",
		reports.length ? (badJoins.length ? `Heard ${reports.length} join${reports.length > 1 ? "s" : ""}: ${badJoins.length} need${badJoins.length > 1 ? "" : "s"} a fix → check_cuts {"fix":true}.` : `Heard the ${reports.length} join${reports.length > 1 ? "s" : ""}: clean.`) : "",
		"Times of later clips changed: read get_project again before more edits.",
	]
		.filter(Boolean)
		.join(" ");
}

/** The split / trim time, seamless unless `exact`: a time inside a word or breath moves into the nearest pause. */
export async function seamlessTime(time: number, exact: boolean, signal: AbortSignal, id?: string): Promise<{ at: number; note?: string }> {
	const fps = projectFps();
	if (exact) return { at: Math.round(time * fps) / fps };
	const { snapTimeAt } = await import("@/hear/client");
	const clip = id ? findSounding(id) : undefined;
	// A clip with no sound of its own (a picture, a silent AI clip, a muted one) is cut where asked: another clip's
	// words under it are no reason to move its edge.
	if (id && (!clip || clip.muted)) return { at: Math.round(time * fps) / fps };
	return snapTimeAt(time, signal, clip ?? undefined).catch(() => ({ at: Math.round(time * fps) / fps }));
}

/**
 * fit_music {id, length | end}: the music ends on a bar line at the wanted length — trimmed to the bar start nearest
 * the target with a one-bar fade-out, or, when the track is too short, looped on bar lines (whole bars, 30 ms joins)
 * and ended the same way. One ⌘Z.
 */
export async function fitMusic(args: Args, signal: AbortSignal): Promise<string> {
	const clip = findSounding(String(args.id ?? "")) ?? fail(`No sound clip "${args.id}". get_project lists the ids.`);
	const fps = projectFps();
	const target = args.end !== undefined ? Number(args.end) : clip.start + Number(args.length);
	if (!Number.isFinite(target) || target < clip.start + 1) fail("Give `length` (seconds) or `end` (timeline seconds) at least 1 s after the clip's start.");
	const m = await mapPlaced(clip, signal);
	const bars = (m.grid?.downbeats ?? []).filter((b) => b > clip.start + 0.05);
	if (bars.length < 3) fail(`No clear bars in «${clip.name}» (no steady beat): trim it with trim and give it a fade-out instead.`);
	const gaps = bars.slice(1).map((b, i) => b - bars[i]).sort((a, b) => a - b);
	const bar = gaps[Math.floor(gaps.length / 2)];
	const frame = (t: number) => Math.round(t * fps) / fps;
	const el = clip.element as TimelineElement & { trimStart: number; trimEnd: number };
	const rate = clip.place.rate || 1;
	const TPS = TICKS_PER_SECOND;
	const srcTotal = (el.trimStart as number) / TPS + ((el.duration as number) / TPS) * rate + (el.trimEnd as number) / TPS;
	const sourceEndT = clip.start + (srcTotal - clip.place.trimStart) / rate;
	const fade = Math.min(1.5, bar);
	const nearest = (list: number[], t: number) => list.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), list[0]);
	if (target <= sourceEndT + 0.01) {
		const choices = bars.filter((b) => b >= clip.start + bar && b <= Math.min(sourceEndT, target + 0.25 * bar));
		const endAt = frame(choices.length ? nearest(choices, target) : nearest(bars, target));
		const duration = endAt - clip.start;
		replaceTracks((tracks) => {
			const one = <K extends { elements: TimelineElement[] }>(t: K): K => ({
				...t,
				elements: t.elements.map((e) =>
					e.id !== el.id ? e : ({ ...e, duration: Math.round(duration * TPS), trimEnd: Math.max(0, Math.round((srcTotal - clip.place.trimStart - duration * rate) * TPS)), params: { ...(e.params ?? {}), fadeOut: fade } } as unknown as TimelineElement),
				),
			});
			return { overlay: tracks.overlay.map(one), main: one(tracks.main), audio: tracks.audio.map(one) } as SceneTracks;
		});
		const n = bars.filter((b) => b < endAt - 1e-3).length + 1;
		return `«${clip.name}» now ends on a bar line at ${endAt.toFixed(3)} s (bar ${n}, ${(endAt - target >= 0 ? "+" : "")}${(endAt - target).toFixed(2)} s from the target) with a ${fade.toFixed(2)} s (one bar) fade-out. ${Math.round(m.grid?.bpm ?? 0)} BPM, a bar is ${bar.toFixed(3)} s.`;
	}
	// Too short: loop whole bars (skip the intro bar), joined exactly on bar lines.
	const inSource = bars.filter((b) => b <= sourceEndT - 0.05);
	const loopFrom = inSource.find((b) => b >= clip.start + bar - 1e-3) ?? inSource[0];
	const loopTo = inSource[inSource.length - 1];
	const loopLen = loopTo - loopFrom;
	if (loopLen < 2 * bar - 1e-3) fail(`«${clip.name}» has too few whole bars to loop.`);
	const track = clip.track;
	const blocking = (track.elements as TimelineElement[]).find((e) => e.id !== el.id && (e.startTime as number) / TPS < target && (e.startTime as number) / TPS >= clip.end - 1e-3);
	if (blocking) fail(`«${blocking.name}» sits on the music's track after it: move it first, then fit the music.`);
	const srcAt = (t: number) => clip.place.trimStart + (t - clip.start) * rate;
	const pieces: TimelineElement[] = [];
	const firstLen = frame(loopTo) - clip.start;
	let t = clip.start + firstLen;
	const wantEnd = frame(target);
	while (t < wantEnd - bar / 2) {
		const left = wantEnd - t;
		const whole = Math.max(1, Math.round(left / bar));
		const len = frame(Math.min(loopLen, whole * bar));
		const last = len >= left - bar / 2;
		pieces.push({
			...el,
			id: generateUUID(),
			startTime: Math.round(t * TPS),
			duration: Math.round(len * TPS),
			trimStart: Math.round(srcAt(loopFrom) * TPS),
			trimEnd: Math.max(0, Math.round((srcTotal - srcAt(loopFrom) - len * rate) * TPS)),
			params: { ...(el.params ?? {}), fadeIn: SEAM_FADE, fadeOut: last ? fade : SEAM_FADE },
		} as unknown as TimelineElement);
		t += len;
		if (last) break;
	}
	replaceTracks((tracks) => {
		const one = <K extends { id: string; elements: TimelineElement[] }>(tr: K): K => {
			if (tr.id !== track.id) return tr;
			const elements = tr.elements.map((e) =>
				e.id !== el.id ? e : ({ ...e, duration: Math.round(firstLen * TPS), trimEnd: Math.max(0, Math.round((srcTotal - srcAt(loopTo)) * TPS)), params: { ...(e.params ?? {}), fadeOut: SEAM_FADE } } as unknown as TimelineElement),
			);
			return { ...tr, elements: [...elements, ...pieces].sort((a, b) => (a.startTime as number) - (b.startTime as number)) };
		};
		return { overlay: tracks.overlay.map(one), main: one(tracks.main), audio: tracks.audio.map(one) } as SceneTracks;
	});
	return `«${clip.name}» looped to ${t.toFixed(3)} s: ${pieces.length} more piece${pieces.length > 1 ? "s" : ""} of bars ${loopFrom.toFixed(2)}–${loopTo.toFixed(2)} s joined on bar lines (30 ms joins), ending on a bar with a ${fade.toFixed(2)} s fade-out. ${Math.round(m.grid?.bpm ?? 0)} BPM.`;
}

/**
 * sounds_like {like, id? | from,to, find?}: Claude's own questions to the sound — how much it sounds like each phrase
 * (0–100 with the reason: the closest everyday sounds the hearing model hears, or the measurements), or with find:true
 * where it does most. Without the model on this Mac: the measured concepts, and its download starts (job list).
 */
export async function soundsLike(args: Args, signal: AbortSignal): Promise<string> {
	const like = (Array.isArray(args.like) ? args.like.map(String) : String(args.like ?? "").split(/[,;]/)).map((x) => x.trim()).filter(Boolean);
	if (!like.length) fail(`Give like: what to compare with, in English words, e.g. ["crowd cheering", "rain", "tense build-up", "sad piano", "echoey room"].`);
	const end = totalSeconds();
	let clips: Sounding[];
	let from: number;
	let to: number;
	if (args.id) {
		const c = await targetClip(String(args.id), signal);
		clips = [c];
		from = Math.max(c.start, Number(args.from ?? c.start));
		to = Math.min(c.end, Number(args.to ?? c.end));
	} else {
		from = Math.max(0, Number(args.from ?? 0) || 0);
		to = Math.min(end, Number(args.to ?? end) || end);
		clips = soundingClips().filter((c) => c.end > from + 0.05 && c.start < to - 0.05);
	}
	if (!clips.length) return `Nothing sounds in ${f2(from)}–${f2(to)} s.`;
	const lines: string[] = [];
	let state: ModelState | undefined;
	let note: string | undefined;
	const english = (q: string) => !/[\u0400-\u04FF]/.test(q);
	const why = (a: { why: string; score: number | null; question: string; by?: string }) => (a.score === null && state === "ready" && !english(a.question) ? `${a.why}; ask in English — the hearing model reads English` : a.why);
	for (const c of clips) {
		const r = await askClip(c, like, { from: Math.max(from, c.start), to: Math.min(to, c.end), find: !!args.find, window: args.window !== undefined ? Number(args.window) : undefined }, signal);
		state ??= r.model;
		note ??= r.note;
		const head = `«${c.name}» (clip ${short(c.element.id)}) ${f2(r.from)}–${f2(r.to)} s`;
		const st = stemOf(c);
		if (st) lines.push(stemLine(st));
		if (c.muted) lines.push(`«${c.name}»: ${c.muted} — heard from its file.`);
		if (!args.find) {
			lines.push(`${head} sounds like: ${(r.answers ?? []).map((a) => (a.score === null ? `«${a.question}» ? (${why(a)})` : `«${a.question}» ${a.score}/100 (${why(a)})`)).join(" · ")}`);
		} else {
			if (r.window && state === "ready") lines.push(`${head}: heard in windows of ${Number(r.window).toFixed(1)} s`);
			for (const f of r.found ?? []) {
				if (f.by !== "heard" && !f.concepts.length) lines.push(`${head}: «${f.question}» ? (${f.why})`);
				else if (!f.hits.length) lines.push(`${head}: «${f.question}» nowhere clearly (best ${f.best ? `${f2(f.best.start)}–${f2(f.best.end)} s ${f.best.score}/100` : "–"})`);
				else lines.push(`${head}: «${f.question}» at ${f.hits.map((h) => `${f2(h.start)}–${f2(h.end)} s (${h.score}/100)`).join(", ")} — ${f.hits[0].why}`);
			}
		}
	}
	wantHearingModel(state);
	if (state === "ready" && !note) lines.push("(Heard by Claude's hearing model on this Mac — CLAP, any English words — scored against 527 everyday sounds: 70+ clearly, 40–70 somewhat, under 40 not; silence, speech and hum are measured from the signal.)");
	else lines.push(`(Measured, not heard: ${note ?? "the hearing model isn't here"}. The measured concepts: ${CONCEPTS.map((c) => c.id).join(", ")}; a phrase outside them answers «?».)`);
	return lines.join("\n");
}

// ───────────────────────── music: what plays when ─────────────────────────

interface MusicReply {
	from: number;
	to: number;
	model?: ModelState;
	note?: string;
	bpm: number;
	bar: number;
	window: number;
	summary?: { genre: Array<[string, number]>; family: string | null; mood: Array<[string, number]>; music: number; singing: number; speech: number; stretches: Array<{ start: number; end: number; plays: string[]; voice: string | null; silent: boolean }>; instruments: Array<[string, number]> };
	sections: Array<{ start: number; end: number; db: number; plays: string[]; voice: string | null; silent: boolean }>;
	lines: Array<{ start: number; end: number; text: string; first: number }>;
}

const pctOf = (p: number) => `${Math.round(p * 100)}%`;
const label = (l: string) => l.replace(/ music$/i, "").toLowerCase();

/** The song a music question is about: the clip by id, else the longest sound; a stem or a part → its song. */
async function songClip(args: Args, signal: AbortSignal): Promise<Sounding> {
	let clip: Sounding;
	if (args.id) clip = await targetClip(String(args.id), signal);
	else {
		await waitSeparation(null, signal);
		const all = soundingClips({ muted: true }).filter((c) => !partOf(c.element));
		clip = [...all].sort((a, b) => Number(!!stemOf(b)) - Number(!!stemOf(a)) || b.end - b.start - (a.end - a.start))[0] ?? fail("No sound on the timeline: place the song first (or give a Media id).");
	}
	return songOfPart(clip);
}

/** A «Split into parts» clip → its song placed the same way (the parts are the whole file, in sync). */
function songOfPart(s: Sounding): Sounding {
	const p = partOf(s.element);
	const song = p ? editor().media.getAssets().find((a) => a.id === p.songId && a.file) : undefined;
	if (!song) return fullMixOf(s);
	return { ...mediaSounding(song, { start: s.start, trimStart: s.place.trimStart, rate: s.place.rate }), end: s.end, element: s.element, track: s.track, name: song.name, ...(s.muted ? { muted: s.muted } : {}) };
}

/** How long a music answer waits for a first separation before saying «still running» (the connector answers in 45 s). */
const SCORE_WAIT = 30_000;

/**
 * analyze {what:"music", id?, from?, to?}: the song's score by parts — the four stems Demucs separates on this Mac
 * (vocals, drums, bass, other), measured: tempo and bars on the drum stem, which parts sound in every run of bars,
 * the sung phrases with the words heard on the voice stem, where the voice is silent and the drums stop, the strongest
 * hits; the AudioSet tagger only for genre and mood. A narrow from..to gives every bar, hit and word there.
 */
export async function hearMusic(args: Args, signal: AbortSignal): Promise<string> {
	const clip = await songClip(args, signal);
	const full = clip;
	const rate = full.place.rate || 1;
	const s0 = full.place.trimStart;
	const s1 = s0 + (full.end - full.start) * rate;
	const toS = (t: number) => s0 + (t - full.start) * rate;
	const from = Math.max(full.start, Number(args.from ?? full.start) || full.start);
	const to = Math.min(full.end, Number(args.to ?? full.end) || full.end);
	const r = await songScore(full, { wait: Number(args.wait) > 0 ? Number(args.wait) * 1000 : SCORE_WAIT, signal });
	const id = short(clip.element.id);
	if (r.state === "running") return `Still separating «${full.name}» into parts on this Mac (${Math.round(r.progress * 100)} % · ${r.stage}). It goes on by itself and is never run twice: send this same call again in about a minute for the score.`;
	if (r.state === "failed") {
		const old = await hearMusicTagger(args, signal).catch((e) => `(the tagger failed too: ${e instanceof Error ? e.message : String(e)})`);
		return `The score by parts couldn't be made: ${r.error}. What the tagger hears on the full mix instead:\n${old}`;
	}
	const sc = r.score;
	const out: string[] = [];
	out.push(`«${full.name}» (${clip.mediaOnly ? "media" : "clip"} ${id}) ${f2(from)}–${f2(to)} s · the score by parts: Demucs stems on this Mac (vocals, drums, bass, other = guitars/keys); times are timeline seconds${clip.muted ? ` · ${clip.muted} (heard from its file)` : ""}`);
	out.push(...scoreText(sc, { toT: (s) => full.start + (s - s0) / rate, s0, s1, from: toS(from), to: toS(to) }));
	// genre and mood only: the tagger on four 10 s windows of the mix (skipped when it isn't here or is slow)
	const style = await quickStyle(full, signal);
	if (style) out.push(style);
	if (!partTracksOf(full).length) out.push(`The parts as tracks: edit {ops:[{op:"split_parts", id:"${id}"}]} (four muted tracks in sync; split_parts {solo:"drums"} hears one alone).`);
	return out.join("\n");
}

function partTracksOf(s: Sounding) {
	const mediaId = (s.element as { mediaId?: string }).mediaId ?? s.asset?.id;
	return mediaId ? partTracks(s.asset?.id ?? mediaId) : [];
}

/** «Genre: punk rock 31 % · mood: angry» from the tagger, or null. */
async function quickStyle(s: Sounding, signal: AbortSignal): Promise<string | null> {
	try {
		const fileId = await fileOf(s);
		const timeout = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
		const res = await fetch("/api/hear/music", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio": "1" }, body: JSON.stringify({ fileId, quick: true, duration: s.asset?.duration ?? s.end - s.start }), signal: timeout });
		const m = (await res.json().catch(() => null)) as MusicReply | null;
		const sm = m?.summary;
		if (!res.ok || !sm) return null;
		return `Genre (AudioSet tagger on the full mix): ${sm.genre.length ? `${sm.family ? `${sm.family} — ` : ""}${sm.genre.map(([l, p]) => `${label(l)} ${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`).join(" · ")}` : "no genre class heard clearly"}${sm.mood.length ? ` · mood: ${sm.mood.map(([l, p]) => `${label(l)} ${pctOf(p)}`).join(", ")}` : ""}`;
	} catch (error) {
		if (signal.aborted) throw error;
		return null;
	}
}

/** split_parts {id}: the song's four parts as muted tracks under it (one ⌘Z); waits for a first separation up to 30 s. */
export async function splitParts(args: Args, signal: AbortSignal): Promise<string> {
	if (args.solo !== undefined) {
		const solo = String(args.solo);
		const clip = args.id ? await targetClip(String(args.id), signal) : await songClip({}, signal);
		const p = partOf(clip.element);
		const songId = p?.songId ?? clip.asset?.id ?? fail("Give the song's or a part's clip id.");
		const part = solo === "mix" || solo === "" ? null : ((["vocals", "drums", "bass", "other"] as const).find((x) => x === solo) ?? fail('solo: "vocals", "drums", "bass", "other" or "mix".'));
		return soloPart(songId, part);
	}
	const clip = args.id ? await targetClip(String(args.id), signal) : await songClip({}, signal);
	if (clip.mediaOnly) fail("Place the song on the timeline first: split_parts lays its parts under its clip.");
	if (partOf(clip.element)) fail(`Clip ${short(clip.element.id)} is already a part of a song.`);
	const r = await songScore(clip, { wait: SCORE_WAIT, signal });
	if (r.state === "running") return `Still separating «${clip.name}» into parts on this Mac (${Math.round(r.progress * 100)} % · ${r.stage}). Send this same call again in about a minute; nothing is run twice.`;
	if (r.state === "failed") fail(`Split into parts: ${r.error}`);
	const line = await splitIntoParts(clip.track.id, clip.element.id);
	const ids = partTracksOf(clip).map((x) => `${x.part} → clip ${short((x.track.elements[0] as { id: string }).id)}`);
	return `${line}${ids.length ? ` Clips: ${ids.join(", ")}.` : ""}`;
}

/**
 * The tagger's view of a song (the answer before the score; kept for when the parts can't be separated): on the FULL
 * MIX — genre and mood, what plays in every stretch of about two bars, the sections, the sung lines.
 */
export async function hearMusicTagger(args: Args, signal: AbortSignal): Promise<string> {
	let clip: Sounding;
	if (args.id) clip = await targetClip(String(args.id), signal);
	else {
		await waitSeparation(null, signal);
		const all = soundingClips({ muted: true });
		// The longest sound that isn't a voice-over: the song (or its stem → its song).
		clip = [...all].sort((a, b) => Number(!!stemOf(b)) - Number(!!stemOf(a)) || b.end - b.start - (a.end - a.start))[0] ?? fail("No sound on the timeline: place the song first (or give a Media id).");
	}
	const full = fullMixOf(clip);
	const from = Math.max(full.start, Number(args.from ?? full.start) || full.start);
	const to = Math.min(full.end, Number(args.to ?? full.end) || full.end);
	const { key } = await listenTo(full, signal);
	const fileId = await fileOf(full);
	const res = await fetch("/api/hear/music", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio": "1" }, body: JSON.stringify({ key, fileId, place: full.place, fps: projectFps(), from, to }), signal });
	const r = (await res.json().catch(() => null)) as (MusicReply & { error?: string }) | null;
	if (!res.ok || !r) fail(r?.error || "The hearing couldn't read the music.");
	const m = r as MusicReply;
	const id = short(clip.element.id);
	const out: string[] = [];
	const st = stemOf(clip);
	out.push(`«${full.name}» (${st ? `the song of ${st.kind} stem ${id}` : `${clip.mediaOnly ? "media" : "clip"} ${id}`}) ${f2(m.from)}–${f2(m.to)} s, heard on the full mix${m.bpm ? ` · ${Math.round(m.bpm)} BPM, a bar every ${m.bar.toFixed(2)} s` : ""}${clip.muted ? ` · ${clip.muted} (heard from its file)` : ""}`);
	if (st) out.push(stemLine(st));
	if (!m.summary) {
		wantHearingModel(m.model);
		out.push(`(Not heard by the tagger: ${m.note ?? "the hearing model isn't here"}. Instruments and genre need it; listen {id} gives the measured music: tempo, key, energy.)`);
		return out.join("\n");
	}
	const sm = m.summary;
	out.push(`Genre (AudioSet tagger on the full mix): ${sm.genre.length ? `${sm.family ? `${sm.family} — ` : ""}${sm.genre.map(([l, p]) => `${label(l)} ${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`).join(" · ")}` : "no genre class heard clearly"}${sm.mood.length ? ` · mood: ${sm.mood.map(([l, p]) => `${label(l)} ${pctOf(p)}`).join(", ")}` : ""} (the tagger's mean over the music; low numbers are normal for a style)`);
	out.push(`Instruments (share of the song they play in): ${sm.instruments.length ? sm.instruments.slice(0, 10).map(([k, p]) => `${k} ${pctOf(p)}`).join(" · ") : "none named clearly"} · a voice sings in ${pctOf(sm.singing)}${sm.speech ? `, speech in ${pctOf(sm.speech)}` : ""} of it`);
	if (m.sections.length) out.push(`Sections (by level): ${m.sections.slice(0, 16).map((x) => `${f2(x.start)}–${f2(x.end)} ${playsLine(x)} (${x.db} dB)`).join(" · ")}`);
	const stretches = sm.stretches.filter((x) => x.end - x.start >= 0.4);
	out.push(`What plays when (windows of ${m.window.toFixed(1)} s, timeline seconds):`);
	for (const x of stretches.slice(0, 60)) out.push(`  ${f2(x.start)}–${f2(x.end)} ${playsLine(x)}`);
	if (stretches.length > 60) out.push(`  … ${stretches.length - 60} more: analyze {what:"music", from:${f2(stretches[60].start)}}`);
	const silent = stretches.filter((x) => x.silent);
	if (silent.length) out.push(`Silence: ${silent.map((x) => `${f2(x.start)}–${f2(x.end)}`).join(", ")}`);
	if (m.lines.length) {
		out.push("Sung lines (where a voice is heard; words from the speech recogniser, may be inexact over loud music):");
		for (const l of m.lines.slice(0, 40)) out.push(`  ${f2(l.start)}–${f2(l.end)} #${l.first + 1} ${l.text}`);
		if (m.lines.length > 40) out.push(`  … ${m.lines.length - 40} more lines: analyze {what:"words", id:"${id}", from:${f2(m.lines[40].start)}}`);
	} else if (sm.singing > 0) out.push("Sung lines: the recogniser found no clear words over the band — analyze the voice stem (separate_voice) for the lyrics.");
	return out.join("\n");
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const S = (description: string) => ({ type: "string", description });
const N = (description: string) => ({ type: "number", description });
const B = (description: string) => ({ type: "boolean", description });

/** The hearing tools, in tools.ts' shape. */
export const HEAR_TOOLS: Array<{ name: string; description: string; parameters: Record<string, unknown>; run: (args: Args, signal: AbortSignal) => Promise<unknown> }> = [
	{
		name: "listen",
		description:
			"Hear a clip or a stretch of the timeline like a sound editor. Returns: what is heard in each stretch, named (rain, applause, piano, sad music… — the AudioSet tagger on this Mac), problems with the exact fix call first (noise, hum, mud, sibilance, echo, uneven level, clipping, clicks, digital-silence holes; music masking the voice), how it sounds (voice pitch, tone, pace, clarity; music energy, mood, BPM, key, builds/drops), the best frame-exact cut points ranked, speech/music/noise stretches, music beats and bars, then every word numbered #n with its start (? unsure, ! stressed, ↘ sentence end) and every pause ‖ with its length and what fills it (silence, room, breath, music). Call it before cutting speech or music and whenever you need to know how something sounds. id = one clip; without id: from..to of the timeline (all clips there, at most 10 min per call). picture:true adds one small image (waveform over spectrogram, words, pauses, beats and cuts marked).",
		parameters: obj({ id: S("Clip id (video with sound or audio), optional"), from: N("Timeline seconds (optional)"), to: N("Timeline seconds (optional)"), picture: B("Also return a picture of the sound") }),
		run: (a, s) => listen(a, s),
	},
	{
		name: "cut_point",
		description:
			"The best frame-exact time to cut near `at` (timeline seconds), or between word #after and the next (numbers from listen/transcript, with the clip `id`): inside a pause, never in a word or breath, on the quietest frame, the speaker's room tone kept; on music on a beat or bar start (music:true). Returns the time and why, plus alternatives. Use it when you need an exact time for split, trim, move or a J/L cut — cut_out, remove_pauses, split and trim already snap to these points by themselves.",
		parameters: obj({ at: N("Timeline seconds"), after: N("Word number #n: cut between it and the next"), id: S("Clip id (needed with after)"), window: N("How far to look, seconds (default 0.5)"), music: B("Cut on the music's beat") }),
		run: (a, s) => cutPoint(a, s),
	},
	{
		name: "check_cuts",
		description:
			"Check every audio cut on the timeline by ear (or only the cuts of `ids`, or within from..to): level jumps, clicks, words or breaths cut off, pauses too long or too short for this speaker, digital-silence holes, music cut off the beat — each with its exact fix. fix:true applies all the fixes itself (frames moved, 10–40 ms audio fades, gaps filled with the clip's own room tone; one ⌘Z), checks again and says what it changed. Call it after cutting speech or music, before you say the edit is done.",
		parameters: obj({ ids: { type: "array", items: { type: "string" }, description: "Clip ids (optional)" }, from: N("Timeline seconds (optional)"), to: N("Timeline seconds (optional)"), fix: B("Apply the fixes") }),
		run: (a, s) => checkCuts(a, s),
	},
	{
		name: "sounds_like",
		description:
			"Ask the sound your own questions in plain English: how much a clip (or from..to of the timeline) sounds like each phrase in `like` — any words, e.g. [\"crowd cheering\", \"rain\", \"tense build-up\", \"sad piano\", \"echoey room\", \"a door slam\", \"upbeat pop\"] — 0–100 each with the closest everyday sounds it hears (Claude's hearing model, CLAP, on this Mac; silence, speech and hum are measured); find:true says where in the range it sounds most like each. Use it to pick music for a mood, find the applause, the build-up or the drop, the calm part, a sound effect.",
		parameters: obj({ like: { type: "array", items: { type: "string" }, description: "Phrases to compare with" }, id: S("Clip id (optional)"), from: N("Timeline seconds"), to: N("Timeline seconds"), find: B("Where does it sound like each?"), window: N("Seconds per window for find (default 3)") }, ["like"]),
		run: (a, s) => soundsLike(a, s),
	},
	{
		name: "hear_music",
		description:
			"The song's score by parts (analyze {what:\"music\"}): the four stems separated on this Mac (vocals, drums, bass, other) measured — tempo per stretch and bars on the drum stem, the sections, which parts sound in every run of bars, the sung phrases with their words (heard on the voice stem), where the voice is silent, where the drums stop, the strongest hits; genre and mood from the tagger. A from..to of ≤ 40 s gives every bar, hit and word there. The first time on a song takes about a third of its length (answers «still running» first: send the same call again). Ask it before cutting a music video: every shot shows what sounds then.",
		parameters: obj({ id: S("Clip or Media id (default: the song on the timeline)"), from: N("Timeline seconds"), to: N("Timeline seconds") }),
		run: (a, s) => hearMusic(a, s),
	},
	{
		name: "split_parts",
		description:
			"Split a song clip into its four parts as tracks under it — «· vocals», «· drums», «· bass», «· other» (guitars, keys) — in sync, muted so the mix doesn't double. solo:\"drums\" (or vocals, bass, other) hears that part alone, solo:\"mix\" the song again. Demucs on this Mac, free; the first time takes about a third of the song's length. One ⌘Z removes them.",
		parameters: obj({ id: S("The song's clip id (default: the longest sound on the timeline)"), solo: S("vocals | drums | bass | other | mix: hear one part alone, or the full mix") }),
		run: (a, s) => splitParts(a, s),
	},
	{
		name: "fit_music",
		description:
			"Make a music clip last `length` seconds (or end at timeline `end`) and end on a bar line, the way an editor fits music: trimmed at the bar start nearest the target with a one-bar fade-out, or — when the track is too short — looped on whole bars joined exactly on bar lines. Use it after placing music under a cut, before export. One ⌘Z.",
		parameters: obj({ id: S("Music clip id"), length: N("Seconds from the clip's start"), end: N("Timeline seconds where it should end") }, ["id"]),
		run: (a, s) => fitMusic(a, s),
	},
	{
		name: "fix_sound",
		description:
			"Fix how a clip sounds with the app's own audio effects, as listen suggests: what = noise (Reduce noise), hum (EQ notches at 50/60 Hz and harmonics; hz:60 for 60 Hz), mud (EQ −5 dB at 220 Hz), sibilance (De-esser), echo (Isolate voice), level (Compressor), duck (music ducks under the voice), quieter / louder (volume by db). One ⌘Z.",
		parameters: obj({ id: S("Clip id"), what: S("noise | hum | mud | sibilance | echo | level | duck | quieter | louder"), db: N("dB for quieter/louder (default 3)"), hz: N("Hum frequency 50 or 60") }, ["id", "what"]),
		run: async (a) => fixSound(a),
	},
];

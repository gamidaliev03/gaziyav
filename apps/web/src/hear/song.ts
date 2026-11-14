// A song is not a recording of someone talking: the voice notes measured on a full mix (pitch range «a low male
// voice» from the band's notes, words per minute, tone) and the recording fixes of a voice (noise, hum, mud,
// sibilance, echo, level swings → fix_sound) say nothing true about a mastered song. The hearing says «sings» or
// «vocals», measures the voice only on a separated vocal, and a stem says what it is. Pure.
import type { Note } from "./describe";

export interface SongView {
	/** The sound is music: a song (full mix), a library track or a music stem. */
	song: boolean;
	/** Someone sings (the tagger hears singing, or it is a song's voice stem). */
	sung: boolean;
	/** A stem of a song separated in Gaziyav (separate_voice). */
	stem: "voice" | "music" | null;
}

/** The recording fixes of a talking voice: wrong advice on a song or on a separated vocal. */
const VOICE_RECORDING = new Set(["noise", "hum", "mud", "thin", "sibilance", "echo", "level"]);

/** Is it music? The tagger's «Music» over the whole range, its singing, the measured music stretches, a beat grid. */
export function isSong(o: { library: boolean; stem: SongView["stem"]; heardAll?: Array<[string, number]>; segments: Array<{ start: number; end: number; kind: string }>; from: number; to: number; pulse?: number; words: number }): SongView {
	const tag = (re: RegExp) => (o.heardAll ?? []).reduce((m, [l, p]) => (re.test(l) && p > m ? p : m), 0);
	const singing = tag(/^(Singing|Male singing|Female singing|Child singing|Choir|Vocal music|A capella|Rapping|Song)$/);
	const music = tag(/^(Music|Musical instrument)$/);
	const len = Math.max(0.01, o.to - o.from);
	const musicShare = o.segments.filter((s) => s.kind === "music" || s.kind === "speech+music").reduce((a, s) => a + Math.min(o.to, s.end) - Math.max(o.from, s.start), 0) / len;
	if (o.stem === "voice") return { song: false, sung: true, stem: "voice" };
	if (o.stem === "music") return { song: true, sung: false, stem: "music" };
	const song = o.library || music >= 0.4 || singing >= 0.15 || musicShare >= 0.5 || ((o.pulse ?? 0) >= 5 && o.words >= 3 && musicShare >= 0.3);
	return { song, sung: song && (singing >= 0.15 || o.words >= 3), stem: null };
}

/** The notes as they apply to this sound: a song keeps its music and level notes, a voice stem its measured range. */
export function notesFor(notes: Note[], v: SongView, words: number): Note[] {
	if (!v.song && !v.stem) return notes;
	const out = notes.filter((n) => {
		if (n.area === "sound" && VOICE_RECORDING.has(n.what)) return false;
		// Words per minute and the speaking tone mean nothing for singing.
		if (n.area === "voice" && (n.what === "tone" || n.what === "pace") && (v.sung || v.song)) return false;
		// A pitch range read from a full mix is the band's, not the singer's (A19).
		if (n.area === "voice" && n.what === "pitch" && v.stem !== "voice") return false;
		return true;
	});
	if (v.stem === "voice") return out.map((n) => (n.area === "voice" && n.what === "pitch" ? { ...n, line: `${v.sung ? "sung" : "voice"}: ${n.line} (measured on the separated vocal)` } : n));
	if (v.song && !v.stem && words >= 3) out.push({ area: "voice", what: "pitch", severity: 0, line: "singing over music: the voice's range is not measured on the mix (separate_voice, then analyze the voice stem)" });
	return out;
}

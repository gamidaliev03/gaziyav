// The song's score by parts: one small, serialisable answer per audio file (cached by the file's content hash), made
// on this Mac from the four stems Demucs separates (drums, bass, other = guitars and keys, vocals). Every time is in
// the file's own seconds (3 decimals); the window maps them to the timeline. Shared by the server (score-server.ts),
// the pure analysis (score.ts), Claude's text (score-text.ts) and «Split into parts» (parts.ts).

export const PARTS = ["vocals", "drums", "bass", "other"] as const;
export type PartName = (typeof PARTS)[number];

/** [start, end] seconds. */
export type Span = [number, number];

export interface PartScore {
	/** Where it plays: its level over its own noise floor, with hysteresis (gaps under a beat or two are bridged). */
	active: Span[];
	/** The level it plays at (95th percentile, dBFS) and its floor (leakage from the other parts, dBFS). */
	peakDb: number;
	floorDb: number;
	/** Mean level per bar (dBFS, rounded), one per `bars` entry. */
	bars: number[];
}

/** A drum hit: time, kind (k = kick, low band; s = snare, mid band; h = hats / cymbals, high band), strength 0–1. */
export type Hit = [number, "k" | "s" | "h", number];

/** A sung (or spoken) phrase on the vocal stem; the words come from the speech recogniser run on that stem. */
export interface Phrase {
	start: number;
	end: number;
	text?: string;
	words?: Array<[string, number, number]>;
}

export interface Section {
	start: number;
	end: number;
	/** Bars (1-based, inclusive). */
	bar0: number;
	bar1: number;
	/** The same letter = the same pattern of parts and energy (part A comes back). */
	letter: string;
	/** intro, verse, chorus, bridge, instrumental, outro — or null when a name would be a guess. */
	name: string | null;
	/** 0–1: how sure the name is (repetition and contrast); 0 without a name. */
	confidence: number;
	/** Parts sounding in at least half of its bars. */
	parts: PartName[];
	/** Mean level of the full mix, dBFS. */
	db: number;
}

export interface SongScore {
	/** Analysis version (bump in score.ts when it changes). */
	v: number;
	key: string;
	duration: number;
	engine: string;
	/** Tempo per stretch where a beat is heard (on the drum stem, else on bass + other). */
	tempo: Array<{ start: number; end: number; bpm: number }>;
	/** Beat times. */
	beats: number[];
	/** Bar starts (downbeats), 4/4 assumed; bars before the first or after the last beat continue the grid. */
	bars: number[];
	/** How sure the downbeat (bar 1 of each tempo stretch) is, 0–1. */
	downbeatConfidence: number;
	/** 3 when the beat model counted three beats in a bar (absent: 4/4, assumed or counted). */
	meter?: 3;
	/**
	 * The beat network answered for this song: tempo, beats and bars are the refereed grid (hear/net-grid.ts), and the
	 * Beat markers, fit_music and check_cuts read them too (studio/server/hear.ts). Absent: they keep their own grid.
	 */
	refereed?: true;
	parts: Record<PartName, PartScore>;
	hits: Hit[];
	/** «other» (guitars, keys): strums and note attacks. */
	attacks: number[];
	phrases: Phrase[];
	/** The language the words were heard in (or "" when no words). */
	language: string;
	sections: Section[];
	/** Every part silent (≥ 0.5 s). */
	silences: Span[];
	/** The drums stop while the song goes on (≥ one bar). */
	breaks: Span[];
	/** Seconds the score took (separation, analysis, words). */
	took: { separate: number; analyse: number; words: number };
}

// Per-clip audio effects (Kadr AudioEffects §A7 + CapCut's Audio → Basic), each a card in Inspector → Audio → «Audio
// effects»: on/off (the boolean `fx.<id>`) and its own settings (`fx.<id>.<key>`, numbers; the EQ's bands as JSON in
// `fx.voice.bands`). Enhance voice, Separate voice and music and the Voice changer are AI tools (neural/).
// The chain is rendered once per clip source and settings on this Mac (Apple AUSoundIsolation + ffmpeg filters, see
// app/api/audio) and the processed audio is what both preview and export play, so what you hear is what you export.
// Every filter here is latency-free (or compensated): the processed audio lines up sample-for-sample with the source.
// Old projects (a switch, no settings) render exactly the fixed graph they always had (`legacy`).

export type AudioFxId = "isolate" | "denoise" | "voice" | "gate" | "deesser" | "compressor" | "reverb" | "normalize" | "limiter";

export interface FxParamSpec {
	key: string;
	label: string;
	min: number;
	max: number;
	step: number;
	default: number;
	unit?: string;
}

export interface FxPreset {
	id: string;
	label: string;
	values: Record<string, number | string>;
}

export interface AudioFxDef {
	id: AudioFxId;
	/** Element param key (boolean): the card's switch. */
	param: string;
	label: string;
	/** The fixed graph of a clip with the switch and no settings (projects made before the settings): kept exactly. */
	legacy: string | null;
	params: FxParamSpec[];
	presets?: FxPreset[];
}

/** Target of «Normalize loudness»: the short-video level (sounds/mix/loudness.ts TARGET_LUFS). */
export const NORMALIZE_LUFS = -14;

// ── the parametric EQ ──

export type EqBandType = "highpass" | "lowshelf" | "peak" | "highshelf" | "lowpass";
export interface EqBand {
	type: EqBandType;
	/** Hz */
	f: number;
	/** dB (shelves and peaks) */
	g: number;
	/** Q (peaks; slope for the others) */
	q: number;
}

export const EQ_BAND_TYPES: readonly EqBandType[] = ["highpass", "lowshelf", "peak", "highshelf", "lowpass"];
export const MAX_EQ_BANDS = 6;

/** Kadr's voice enhance: HPF 80 Hz, low shelf −1.4 dB, presence +2.1 dB @ 3.2 kHz, air +1.4 dB. */
export const EQ_PRESETS: Array<{ id: string; label: string; bands: EqBand[] }> = [
	{
		id: "voice",
		label: "Voice",
		bands: [
			{ type: "highpass", f: 80, g: 0, q: 0.71 },
			{ type: "lowshelf", f: 120, g: -1.4, q: 0.71 },
			{ type: "peak", f: 3200, g: 2.1, q: 0.9 },
			{ type: "highshelf", f: 8000, g: 1.4, q: 0.71 },
		],
	},
	{
		id: "podcast",
		label: "Podcast",
		bands: [
			{ type: "highpass", f: 90, g: 0, q: 0.71 },
			{ type: "peak", f: 250, g: -2.5, q: 1 },
			{ type: "peak", f: 3000, g: 3, q: 1 },
			{ type: "highshelf", f: 10000, g: 2, q: 0.71 },
		],
	},
	{
		id: "music",
		label: "Music",
		bands: [
			{ type: "lowshelf", f: 100, g: 2, q: 0.71 },
			{ type: "peak", f: 400, g: -1, q: 1 },
			{ type: "peak", f: 3000, g: 1, q: 1 },
			{ type: "highshelf", f: 10000, g: 2, q: 0.71 },
		],
	},
	{
		id: "phone",
		label: "Phone",
		bands: [
			{ type: "highpass", f: 300, g: 0, q: 0.71 },
			{ type: "peak", f: 1500, g: 4, q: 1.2 },
			{ type: "lowpass", f: 3400, g: 0, q: 0.71 },
		],
	},
	{
		id: "warm",
		label: "Warm",
		bands: [
			{ type: "lowshelf", f: 200, g: 3, q: 0.71 },
			{ type: "peak", f: 3000, g: -1.5, q: 1 },
			{ type: "highshelf", f: 8000, g: -2, q: 0.71 },
		],
	},
];

const clampBand = (b: Partial<EqBand>): EqBand | null => {
	if (!b || !EQ_BAND_TYPES.includes(b.type as EqBandType)) return null;
	const num = (v: unknown, def: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
	return { type: b.type as EqBandType, f: num(b.f, 1000, 20, 20000), g: num(b.g, 0, -24, 24), q: num(b.q, 0.71, 0.1, 10) };
};

/** The bands stored on a clip (null when it has none: the Voice preset / the old fixed graph). */
export function readEqBands(raw: unknown): EqBand[] | null {
	if (typeof raw !== "string" || !raw) return null;
	try {
		const list = JSON.parse(raw);
		if (!Array.isArray(list)) return null;
		return list.map(clampBand).filter((b): b is EqBand => !!b).slice(0, MAX_EQ_BANDS);
	} catch {
		return null;
	}
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function eqGraph(bands: readonly EqBand[]): string {
	return bands
		.map((b) => {
			switch (b.type) {
				case "highpass":
					return `highpass=f=${r2(b.f)}:p=2:t=q:w=${r2(b.q)}`;
				case "lowpass":
					return `lowpass=f=${r2(b.f)}:p=2:t=q:w=${r2(b.q)}`;
				case "lowshelf":
					return `lowshelf=f=${r2(b.f)}:g=${r2(b.g)}:t=q:w=${r2(b.q)}`;
				case "highshelf":
					return `highshelf=f=${r2(b.f)}:g=${r2(b.g)}:t=q:w=${r2(b.q)}`;
				default:
					return `equalizer=f=${r2(b.f)}:t=q:w=${r2(b.q)}:g=${r2(b.g)}`;
			}
		})
		.join(",");
}

/** The EQ's response in dB at `f` Hz (RBJ biquads at 48 kHz) — the curve the card draws. */
export function eqResponse(bands: readonly EqBand[], f: number, rate = 48000): number {
	let db = 0;
	for (const b of bands) {
		const w0 = (2 * Math.PI * b.f) / rate;
		const cos = Math.cos(w0);
		const alpha = Math.sin(w0) / (2 * b.q);
		const A = 10 ** (b.g / 40);
		let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
		switch (b.type) {
			case "highpass":
				b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
				break;
			case "lowpass":
				b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
				break;
			case "lowshelf": {
				const s = 2 * Math.sqrt(A) * alpha;
				b0 = A * (A + 1 - (A - 1) * cos + s); b1 = 2 * A * (A - 1 - (A + 1) * cos); b2 = A * (A + 1 - (A - 1) * cos - s);
				a0 = A + 1 + (A - 1) * cos + s; a1 = -2 * (A - 1 + (A + 1) * cos); a2 = A + 1 + (A - 1) * cos - s;
				break;
			}
			case "highshelf": {
				const s = 2 * Math.sqrt(A) * alpha;
				b0 = A * (A + 1 + (A - 1) * cos + s); b1 = -2 * A * (A - 1 + (A + 1) * cos); b2 = A * (A + 1 + (A - 1) * cos - s);
				a0 = A + 1 - (A - 1) * cos + s; a1 = 2 * (A - 1 - (A + 1) * cos); a2 = A + 1 - (A - 1) * cos - s;
				break;
			}
			default:
				b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
		}
		const w = (2 * Math.PI * f) / rate;
		const re = (c0: number, c1: number, c2: number) => c0 + c1 * Math.cos(-w) + c2 * Math.cos(-2 * w);
		const im = (c1: number, c2: number) => c1 * Math.sin(-w) + c2 * Math.sin(-2 * w);
		const num = Math.hypot(re(b0, b1, b2), im(b1, b2));
		const den = Math.hypot(re(a0, a1, a2), im(a1, a2));
		db += 20 * Math.log10(Math.max(1e-9, num / den));
	}
	return db;
}

// ── the compressor's curve ──

/** Output level (dB) for an input level (dB): threshold, ratio, a soft knee (dB wide), makeup — the card's graph. */
export function compressorCurve(input: number, s: { threshold: number; ratio: number; knee: number; makeup: number }): number {
	const over = input - s.threshold;
	const k = Math.max(0, s.knee);
	let out: number;
	if (2 * over < -k) out = input;
	else if (2 * Math.abs(over) <= k) out = input + ((1 / s.ratio - 1) * (over + k / 2) ** 2) / (2 * Math.max(k, 1e-6));
	else out = s.threshold + over / s.ratio;
	return out + s.makeup;
}

// ── the reverb ──

export const REVERB_PRESETS: FxPreset[] = [
	{ id: "small", label: "Small room", values: { decay: 0.35, predelay: 4, damping: 55, mix: 18, size: 25 } },
	{ id: "room", label: "Room", values: { decay: 0.7, predelay: 10, damping: 45, mix: 22, size: 45 } },
	{ id: "plate", label: "Plate", values: { decay: 1.4, predelay: 2, damping: 20, mix: 20, size: 70 } },
	{ id: "hall", label: "Hall", values: { decay: 2.4, predelay: 25, damping: 35, mix: 25, size: 90 } },
];

/** What the route needs to build the reverb's impulse response (studio: app/api/audio → reverbIr). */
export interface ReverbPlan {
	decay: number;
	predelay: number;
	damping: number;
	size: number;
	mix: number;
}

const dbToLin = (db: number) => 10 ** (db / 20);
const lin = (db: number) => Math.round(dbToLin(db) * 10000) / 10000;

export const AUDIO_FX: readonly AudioFxDef[] = [
	{ id: "isolate", param: "fx.isolate", label: "Isolate voice", legacy: null, params: [] },
	{
		id: "denoise",
		param: "fx.denoise",
		label: "Reduce noise",
		// FFT denoiser that follows the noise floor, 12 dB of reduction.
		legacy: "afftdn=nr=12:nf=-40:tn=1",
		params: [
			{ key: "amount", label: "Reduction", min: 1, max: 40, step: 1, default: 12, unit: "dB" },
			{ key: "floor", label: "Noise floor", min: -80, max: -20, step: 1, default: -40, unit: "dB" },
		],
		presets: [
			{ id: "light", label: "Light cleanup", values: { amount: 6, floor: -50 } },
			{ id: "medium", label: "Medium cleanup", values: { amount: 12, floor: -40 } },
			{ id: "strong", label: "Strong cleanup", values: { amount: 24, floor: -35 } },
		],
	},
	{
		id: "gate",
		param: "fx.gate",
		label: "Noise gate",
		// threshold −45 dB, range 40 dB, attack 2 ms, release 150 ms
		legacy: "agate=threshold=0.0056:range=0.01:attack=2:release=150",
		params: [
			{ key: "threshold", label: "Threshold", min: -80, max: -10, step: 1, default: -45, unit: "dB" },
			{ key: "range", label: "Range", min: 3, max: 80, step: 1, default: 40, unit: "dB" },
			{ key: "attack", label: "Attack", min: 0.1, max: 100, step: 0.1, default: 2, unit: "ms" },
			{ key: "release", label: "Release", min: 10, max: 2000, step: 5, default: 150, unit: "ms" },
		],
	},
	{
		id: "voice",
		param: "fx.voice",
		label: "Equalizer",
		// Kadr's voice enhance (amount 0.7): its EQ, then a compressor −24 dB 3.4:1 8/140 ms, makeup +2.8 dB.
		legacy:
			"highpass=f=80,lowshelf=f=120:g=-1.4,equalizer=f=3200:t=q:w=0.9:g=2.1,highshelf=f=8000:g=1.4," +
			"acompressor=threshold=0.0617:ratio=3.4:attack=8:release=140:makeup=1.38",
		params: [],
	},
	{
		id: "deesser",
		param: "fx.deesser",
		label: "De-esser",
		legacy: "deesser=i=0.6:m=0.5:f=0.5:s=o",
		params: [
			{ key: "amount", label: "Intensity", min: 0, max: 100, step: 1, default: 60, unit: "%" },
			// ffmpeg's own 0…1 control (it documents no Hz for it): shown as it is, 50 % = the old fixed value
			{ key: "frequency", label: "Frequency", min: 0, max: 100, step: 1, default: 50, unit: "%" },
		],
	},
	{
		id: "compressor",
		param: "fx.compressor",
		label: "Compressor",
		legacy: "acompressor=threshold=0.126:ratio=3:attack=10:release=120",
		params: [
			{ key: "threshold", label: "Threshold", min: -60, max: 0, step: 0.5, default: -18, unit: "dB" },
			{ key: "ratio", label: "Ratio", min: 1, max: 20, step: 0.1, default: 3, unit: ":1" },
			{ key: "attack", label: "Attack", min: 0.1, max: 200, step: 0.1, default: 10, unit: "ms" },
			{ key: "release", label: "Release", min: 10, max: 2000, step: 5, default: 120, unit: "ms" },
			{ key: "knee", label: "Knee", min: 1, max: 8, step: 0.1, default: 2.8, unit: "dB" },
			{ key: "makeup", label: "Makeup", min: 0, max: 24, step: 0.5, default: 0, unit: "dB" },
		],
		presets: [
			{ id: "gentle", label: "Gentle", values: { threshold: -20, ratio: 2, attack: 20, release: 200, knee: 4, makeup: 1 } },
			{ id: "voice", label: "Voice", values: { threshold: -18, ratio: 3, attack: 10, release: 120, knee: 2.8, makeup: 2 } },
			{ id: "punchy", label: "Punchy", values: { threshold: -24, ratio: 4, attack: 5, release: 80, knee: 2, makeup: 4 } },
			{ id: "broadcast", label: "Broadcast", values: { threshold: -28, ratio: 6, attack: 3, release: 100, knee: 3, makeup: 6 } },
		],
	},
	{
		id: "reverb",
		param: "fx.reverb",
		label: "Reverb",
		// Small room (mix ~0.25): early reflections, dry signal untouched.
		legacy: "aecho=in_gain=1:out_gain=0.9:delays=23|31|41|53|67|83:decays=0.22|0.19|0.16|0.13|0.1|0.08",
		params: [
			{ key: "mix", label: "Mix", min: 0, max: 100, step: 1, default: 22, unit: "%" },
			{ key: "decay", label: "Decay", min: 0.1, max: 6, step: 0.05, default: 0.7, unit: "s" },
			{ key: "size", label: "Size", min: 0, max: 100, step: 1, default: 45, unit: "%" },
			{ key: "predelay", label: "Pre-delay", min: 0, max: 200, step: 1, default: 10, unit: "ms" },
			{ key: "damping", label: "Damping", min: 0, max: 100, step: 1, default: 45, unit: "%" },
		],
		presets: REVERB_PRESETS,
	},
	{
		id: "normalize",
		param: "fx.normalize",
		label: "Normalize loudness",
		// the clip's integrated loudness to −14 LUFS by one gain (measured first, app/api/audio)
		legacy: null,
		params: [{ key: "target", label: "Target", min: -30, max: -6, step: 0.5, default: NORMALIZE_LUFS, unit: "LUFS" }],
		presets: [
			{ id: "social", label: "Social video −14", values: { target: -14 } },
			{ id: "podcast", label: "Podcast −16", values: { target: -16 } },
			{ id: "broadcast", label: "Broadcast −23", values: { target: -23 } },
		],
	},
	{
		id: "limiter",
		param: "fx.limiter",
		label: "Limiter",
		// −1 dB, 80 ms release, look-ahead compensated (no delay), no auto-level
		legacy: "alimiter=limit=0.891:release=80:latency=1:level=false",
		params: [
			{ key: "ceiling", label: "Ceiling", min: -12, max: 0, step: 0.1, default: -1, unit: "dB" },
			{ key: "release", label: "Release", min: 5, max: 500, step: 1, default: 80, unit: "ms" },
		],
	},
];

const BY_ID = new Map(AUDIO_FX.map((f) => [f.id, f]));
const IDS = new Set<string>(AUDIO_FX.map((f) => f.id));

/** Settings of the effects on a clip that has its own (the rest render their fixed graph): { compressor: {...} }. */
export type FxSettings = Partial<Record<AudioFxId, Record<string, number | string>>>;

/** Enabled effects of a clip, in processing order (empty = untouched). */
export function readFxChain(element: { params: Record<string, unknown> }): AudioFxId[] {
	return AUDIO_FX.filter((f) => element.params[f.param] === true).map((f) => f.id);
}

export function parseFxChain(raw: string): AudioFxId[] | null {
	const ids = raw.split(",").filter(Boolean);
	if (ids.length === 0 || ids.some((id) => !IDS.has(id))) return null;
	// Always the canonical order.
	return AUDIO_FX.filter((f) => ids.includes(f.id)).map((f) => f.id);
}

/** The settings keys of an effect on a clip (`fx.compressor.ratio` …, `fx.voice.bands`). */
export const fxKey = (id: AudioFxId, key: string) => `fx.${id}.${key}`;

/**
 * Whether the clip has settings of its own for this effect (else the fixed graph of old projects). A setting set back
 * (↺) is stored as null — an update merges params, it can't take a key away — and counts as none.
 */
export function hasOwnSettings(params: Record<string, unknown>, id: AudioFxId): boolean {
	const prefix = `fx.${id}.`;
	return Object.entries(params).some(([k, v]) => k.startsWith(prefix) && v !== null && v !== undefined);
}

/** An effect's settings on a clip: its stored values over the defaults (numbers clamped to their range). */
export function readFxSettings(params: Record<string, unknown>, id: AudioFxId): Record<string, number> {
	const def = BY_ID.get(id);
	const out: Record<string, number> = {};
	for (const p of def?.params ?? []) {
		const v = params[fxKey(id, p.key)];
		out[p.key] = typeof v === "number" && Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : p.default;
	}
	return out;
}

/** The settings the render needs: only the effects that have their own (old projects send none). */
export function fxSettingsOf(element: { params: Record<string, unknown> }): FxSettings {
	const out: FxSettings = {};
	for (const id of readFxChain(element)) {
		if (!hasOwnSettings(element.params, id)) continue;
		if (id === "voice") {
			const bands = readEqBands(element.params[fxKey("voice", "bands")]);
			if (bands) out.voice = { bands: JSON.stringify(bands) };
			continue;
		}
		out[id] = readFxSettings(element.params, id);
	}
	return out;
}

/** Validates settings that came in a request (unknown effects / keys dropped, numbers clamped). */
export function parseFxSettings(raw: string | null): FxSettings {
	if (!raw) return {};
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return {};
	}
	if (!data || typeof data !== "object") return {};
	const out: FxSettings = {};
	for (const [id, values] of Object.entries(data as Record<string, unknown>)) {
		if (!IDS.has(id) || !values || typeof values !== "object") continue;
		const v = values as Record<string, unknown>;
		if (id === "voice") {
			const bands = readEqBands(v.bands);
			if (bands) out.voice = { bands: JSON.stringify(bands) };
			continue;
		}
		const params: Record<string, unknown> = {};
		for (const [k, value] of Object.entries(v)) params[fxKey(id as AudioFxId, k)] = value;
		out[id as AudioFxId] = readFxSettings(params, id as AudioFxId);
	}
	return out;
}

/** One effect's ffmpeg graph: from its settings, else the fixed one; null for the route's own steps. */
export function fxGraph(id: AudioFxId, settings?: Record<string, number | string>): string | null {
	const def = BY_ID.get(id);
	if (!def) return null;
	if (!settings) return def.legacy;
	const n = (key: string) => {
		const v = settings[key];
		const spec = def.params.find((p) => p.key === key);
		return typeof v === "number" ? v : (spec?.default ?? 0);
	};
	switch (id) {
		case "denoise":
			return `afftdn=nr=${r2(n("amount"))}:nf=${r2(n("floor"))}:tn=1`;
		case "gate":
			return `agate=threshold=${lin(n("threshold"))}:range=${lin(-n("range"))}:attack=${r2(n("attack"))}:release=${r2(n("release"))}`;
		case "voice": {
			const bands = readEqBands(settings.bands);
			return bands && bands.length ? eqGraph(bands) : "";
		}
		case "deesser":
			return `deesser=i=${r2(n("amount") / 100)}:m=0.5:f=${r2(n("frequency") / 100)}:s=o`;
		case "compressor":
			return `acompressor=threshold=${lin(n("threshold"))}:ratio=${r2(n("ratio"))}:attack=${r2(n("attack"))}:release=${r2(n("release"))}:knee=${r2(n("knee"))}:makeup=${lin(n("makeup"))}`;
		case "limiter":
			return `alimiter=limit=${lin(n("ceiling"))}:release=${r2(n("release"))}:latency=1:level=false`;
		default:
			return def.legacy;
	}
}

/**
 * ffmpeg filter graph for the non-native part of a chain ('' when nothing to do). Normalization is measured between
 * two passes, so the route asks for the part before it (`before: "normalize"`) and the part after it (`after`).
 */
export function ffmpegFilterFor(chain: readonly AudioFxId[], { before, after, settings = {} }: { before?: AudioFxId; after?: AudioFxId; settings?: FxSettings } = {}): string {
	const order = AUDIO_FX.map((f) => f.id);
	const from = after ? order.indexOf(after) + 1 : 0;
	const to = before ? order.indexOf(before) : order.length;
	return AUDIO_FX.slice(from, to)
		.filter((f) => chain.includes(f.id))
		.map((f) => fxGraph(f.id, settings[f.id]))
		.filter((g): g is string => !!g)
		.join(",");
}

/** The render as steps: ffmpeg graphs, the reverb (an impulse response of its own), the loudness gain. */
export type FxStep = { kind: "graph"; graph: string } | { kind: "reverb"; plan: ReverbPlan } | { kind: "normalize"; target: number };

export function fxSteps(chain: readonly AudioFxId[], settings: FxSettings = {}): FxStep[] {
	const steps: FxStep[] = [];
	let pending: string[] = [];
	const flush = () => {
		if (pending.length) steps.push({ kind: "graph", graph: pending.join(",") });
		pending = [];
	};
	for (const f of AUDIO_FX) {
		if (!chain.includes(f.id) || f.id === "isolate") continue;
		if (f.id === "normalize") {
			flush();
			steps.push({ kind: "normalize", target: settings.normalize ? Number(settings.normalize.target) : NORMALIZE_LUFS });
			continue;
		}
		if (f.id === "reverb" && settings.reverb) {
			flush();
			const s = settings.reverb as Record<string, number>;
			steps.push({ kind: "reverb", plan: { decay: s.decay, predelay: s.predelay, damping: s.damping, size: s.size, mix: s.mix } });
			continue;
		}
		const g = fxGraph(f.id, settings[f.id]);
		if (g) pending.push(g);
	}
	flush();
	return steps;
}

/** A stable short text of the settings (the processed audio is cached by it). */
export function fxSettingsKey(settings: FxSettings): string {
	const ids = Object.keys(settings).sort() as AudioFxId[];
	return ids.map((id) => `${id}:${JSON.stringify(Object.entries(settings[id] ?? {}).sort())}`).join(";");
}

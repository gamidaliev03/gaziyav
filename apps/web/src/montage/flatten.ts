// Flattening of AI compositions (preview, audio, export): every composition clip is replaced by its inner clips
// shifted into place and seen through the clip's own transform; AI layers go to the Remotion layer as items.
// Pure (no editor core, no wasm), so it is unit-tested directly; the timebase is configured by compositions.ts.
import type { GraphicElement, OverlayTrack, AudioTrack, RetimeConfig, SceneTracks, TimelineElement, TimelineTrack, TScene, VideoTrack } from "@/timeline/types";
import { buildEmptyTrack } from "@/timeline/placement/track-factory";
import type { MediaTime } from "@/wasm";
import type { ElementAnimations, ScalarAnimationKey } from "@/animation/types";
import { resolveAnimationPathValueAtTime } from "@/animation/resolve";
import { getSourceSpanAtClipTime, splitRetimeAtClipTime } from "@/retime/split";
import { AI_PREFIX, propsFromParams } from "./catalog";
import { applyMotion, motionAt, readMotion, withoutMotion } from "./motion";
import type { MontageItem } from "./types";

let TICKS = 120000;
/** The editor's ticks per second (set once by compositions.ts from the wasm timebase). */
export function configureTimebase(ticksPerSecond: number) {
	TICKS = ticksPerSecond;
}
const sec = (t: number) => t / TICKS;

export const COMPOSITION_DEF = `${AI_PREFIX}Composition`;

export const isComposition = (el: TimelineElement | undefined | null): el is GraphicElement =>
	!!el && el.type === "graphic" && el.definitionId === COMPOSITION_DEF;
export const isAiLayer = (el: TimelineElement | undefined | null): el is GraphicElement =>
	!!el && el.type === "graphic" && el.definitionId.startsWith(AI_PREFIX) && el.definitionId !== COMPOSITION_DEF;

// ───────────────────────── flattening (preview, audio, export) ─────────────────────────

interface Window {
	/** Parent-time ticks of the composition's visible range. */
	start: number;
	end: number;
	/** Parent time of inner time 0. */
	offset: number;
}

/**
 * The element as it shows through the composition's window (parent time): moved by the window's offset and cut at
 * the window's edges exactly like a split would cut it — the source cut follows the clip's speed (and speed ramp),
 * and its keyframes stay locked to the composition's inner time.
 */
function placeInWindow<T extends TimelineElement>(el: T, w: Window): T | null {
	const start = el.startTime + w.offset;
	if (start + el.duration <= w.start || start >= w.end) return null;
	let out = { ...el, startTime: start as MediaTime } as T;
	if (start < w.start) out = cutHead(out, w.start - start);
	const over = out.startTime + out.duration - w.end;
	if (over > 0) out = cutTail(out, over);
	return out;
}

const retimeOf = (el: TimelineElement): RetimeConfig | undefined => ("retime" in el ? el.retime : undefined);

function cutHead<T extends TimelineElement>(el: T, head: number): T {
	const retime = retimeOf(el);
	const span = Math.round(getSourceSpanAtClipTime({ clipTime: head, retime, duration: el.duration }));
	return {
		...el,
		startTime: (el.startTime + head) as MediaTime,
		duration: (el.duration - head) as MediaTime,
		trimStart: (el.trimStart + span) as MediaTime,
		...(retime ? { retime: splitRetimeAtClipTime({ retime, splitClipTime: head, duration: el.duration }).right } : {}),
		...(el.animations ? { animations: shiftAnimations(el.animations, -head) } : {}),
	};
}

function cutTail<T extends TimelineElement>(el: T, tail: number): T {
	const retime = retimeOf(el);
	const keep = el.duration - tail;
	const total = Math.round(getSourceSpanAtClipTime({ clipTime: el.duration, retime, duration: el.duration }));
	const kept = Math.round(getSourceSpanAtClipTime({ clipTime: keep, retime, duration: el.duration }));
	return {
		...el,
		duration: keep as MediaTime,
		trimEnd: (el.trimEnd + total - kept) as MediaTime,
		...(retime ? { retime: splitRetimeAtClipTime({ retime, splitClipTime: keep, duration: el.duration }).left } : {}),
	};
}

/** Every keyframe of every channel moved by `delta` ticks. */
export function shiftAnimations(animations: ElementAnimations, delta: number): ElementAnimations {
	const shift = (c: unknown) => {
		const ch = c as { keys?: { time: number }[] } | undefined;
		return ch && Array.isArray(ch.keys) ? { ...ch, keys: ch.keys.map((k) => ({ ...k, time: (k.time + delta) as MediaTime })) } : c;
	};
	const out: ElementAnimations = {};
	for (const [path, data] of Object.entries(animations)) {
		if (!data) continue;
		if (Array.isArray((data as { keys?: unknown }).keys)) out[path] = shift(data) as ElementAnimations[string];
		else out[path] = Object.fromEntries(Object.entries(data).map(([k, c]) => [k, shift(c)])) as ElementAnimations[string];
	}
	return out;
}

const trackHidden = (t: TimelineTrack) => "hidden" in t && !!t.hidden;

export interface Flattened {
	tracks: SceneTracks;
	/** AI layers in parent time, top first. */
	items: MontageItem[];
}

// ───────────────────────── the composition clip's transform ─────────────────────────

/** Position (canvas px from the centre), scale, rotation (deg) and opacity of an element. */
export interface Tf {
	x: number;
	y: number;
	sx: number;
	sy: number;
	rot: number;
	op: number;
}

export const IDENTITY_TF: Tf = { x: 0, y: 0, sx: 1, sy: 1, rot: 0, op: 1 };

export function tfOf(params: Record<string, unknown>): Tf {
	const n = (k: string, d: number) => (typeof params[k] === "number" && Number.isFinite(params[k]) ? (params[k] as number) : d);
	return { x: n("transform.positionX", 0), y: n("transform.positionY", 0), sx: n("transform.scaleX", 1), sy: n("transform.scaleY", 1), rot: n("transform.rotate", 0), op: n("opacity", 1) };
}

export const isIdentityTf = (t: Tf) => t.x === 0 && t.y === 0 && t.sx === 1 && t.sy === 1 && t.rot === 0 && t.op === 1;

/**
 * The child seen through its composition clip: the clip's move/scale/rotation (about the frame centre) applied on
 * top of the child's own; opacities multiply. Exact for uniform scale, the usual case.
 */
export function composeTf(parent: Tf, child: Tf): Tf {
	const r = (parent.rot * Math.PI) / 180;
	const cx = child.x * parent.sx;
	const cy = child.y * parent.sy;
	return {
		x: parent.x + cx * Math.cos(r) - cy * Math.sin(r),
		y: parent.y + cx * Math.sin(r) + cy * Math.cos(r),
		sx: parent.sx * child.sx,
		sy: parent.sy * child.sy,
		rot: parent.rot + child.rot,
		op: parent.op * child.op,
	};
}

const VISUAL = new Set(["video", "image", "text", "graphic", "sticker"]);

/** The transform paths, in the order of `Tf`'s fields (and of `MontageItem.tfk` samples). */
const TF_PATHS = ["transform.positionX", "transform.positionY", "transform.scaleX", "transform.scaleY", "transform.rotate", "opacity"] as const;
const TF_FIELDS = ["x", "y", "sx", "sy", "rot", "op"] as const;
/** Largest error a simplified sampled channel may have against the exact curve (px, ×, ×, deg, alpha). */
const TF_TOLERANCE = [0.02, 0.02, 1e-4, 1e-4, 0.005, 1e-3];

/** True when the element has keyframes on its position, scale, rotation or opacity. */
export function hasTfAnimation(el: { animations?: ElementAnimations }): boolean {
	const a = el.animations;
	if (!a) return false;
	return TF_PATHS.some((path) => {
		const keys = (a[path] as { keys?: unknown[] } | undefined)?.keys;
		return Array.isArray(keys) && keys.length > 0;
	});
}

/** The element's transform at parent time `t` (ticks), keyframes included — resolved the way the renderer does. */
export function tfAt(el: { startTime: number; duration: number; params: Record<string, unknown>; animations?: ElementAnimations }, t: number): Tf {
	const base = tfOf(el.params);
	if (!hasTfAnimation(el)) return base;
	const localTime = Math.min(Math.max(t - el.startTime, 0), el.duration);
	const at = (i: number) =>
		resolveAnimationPathValueAtTime({ animations: el.animations, propertyPath: TF_PATHS[i], localTime, fallbackValue: base[TF_FIELDS[i]] });
	return { x: at(0), y: at(1), sx: at(2), sy: at(3), rot: at(4), op: at(5) };
}

/**
 * The transform a composition clip applies to its contents, as a function of parent time (ticks): its own
 * (keyframes included) composed down nested compositions. `animated` is false when it never changes.
 */
export interface ParentTf {
	base: Tf;
	animated: boolean;
	at: (t: number) => Tf;
}

const staticParent = (tf: Tf): ParentTf => ({ base: tf, animated: false, at: () => tf });
const IDENTITY_PARENT = staticParent(IDENTITY_TF);

function throughComposition(parent: ParentTf, el: GraphicElement): ParentTf {
	if (!parent.animated && !hasTfAnimation(el)) return staticParent(composeTf(parent.base, tfOf(el.params as Record<string, unknown>)));
	const at = (t: number) => composeTf(parent.at(t), tfAt(el as never, t));
	return { base: at(el.startTime), animated: true, at };
}

/** Sample rate of a keyframed composite transform: a multiple of the frame rate, at least 60 Hz (exact on frames). */
export const sampleRate = (fps: number) => (fps > 0 ? fps * Math.max(1, Math.ceil(60 / fps - 1e-9)) : 60);

/** The composed transform over the element's visible range, every 1/rate s from its start: [x, y, sx, sy, rot, op]×n. */
function sampleComposed(el: TimelineElement, parent: ParentTf, rate: number): number[] {
	const n = Math.max(2, Math.ceil((el.duration * rate) / TICKS - 1e-9) + 1);
	const step = TICKS / rate;
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		const t = el.startTime + i * step;
		const c = composeTf(parent.at(t), tfAt(el as never, t));
		out.push(c.x, c.y, c.sx, c.sy, c.rot, c.op);
	}
	return out;
}

/** Douglas–Peucker on one sampled channel: the fewest linear keys that stay within `tol` of every sample. */
function simplify(times: number[], values: number[], tol: number): number[] {
	const keep = new Uint8Array(values.length);
	keep[0] = 1;
	keep[values.length - 1] = 1;
	const stack: [number, number][] = [[0, values.length - 1]];
	while (stack.length) {
		const [a, b] = stack.pop()!;
		let worst = -1;
		let err = tol;
		for (let i = a + 1; i < b; i++) {
			const k = (times[i] - times[a]) / (times[b] - times[a]);
			const e = Math.abs(values[a] + (values[b] - values[a]) * k - values[i]);
			if (e > err) {
				err = e;
				worst = i;
			}
		}
		if (worst > 0) {
			keep[worst] = 1;
			stack.push([a, worst], [worst, b]);
		}
	}
	const idx: number[] = [];
	keep.forEach((v, i) => {
		if (v) idx.push(i);
	});
	return idx;
}

/**
 * An inner clip drawn through its composition clip's transform. A still transform is composed into the clip's own
 * values; a keyframed one (the clip's or the composition's) becomes linear keyframes sampled from the exact composed
 * curve on the frame grid and simplified within a sub-pixel tolerance — the renderer plays it like any keyframes.
 */
function throughParent<T extends TimelineElement>(el: T, parent: ParentTf | undefined, rate: number): T {
	if (!parent || !VISUAL.has(el.type)) return el;
	if (!parent.animated) {
		if (isIdentityTf(parent.base)) return el;
		if (!hasTfAnimation(el)) {
			const t = composeTf(parent.base, tfOf(el.params as Record<string, unknown>));
			return { ...el, params: { ...el.params, ...tfParams(t) } };
		}
	}
	const samples = sampleComposed(el, parent, rate);
	const n = samples.length / 6;
	const step = TICKS / rate;
	const times = Array.from({ length: n }, (_, i) => Math.round(i * step));
	const animations: ElementAnimations = { ...(el.animations ?? {}) };
	const params: Record<string, unknown> = { ...el.params };
	TF_PATHS.forEach((path, j) => {
		delete animations[path];
		const values = Array.from({ length: n }, (_, i) => samples[i * 6 + j]);
		params[path] = values[0];
		let lo = values[0];
		let hi = values[0];
		for (const v of values) {
			if (v < lo) lo = v;
			if (v > hi) hi = v;
		}
		if (hi - lo <= TF_TOLERANCE[j]) return;
		const keys: ScalarAnimationKey[] = simplify(times, values, TF_TOLERANCE[j]).map((i) => ({
			id: `tf${j}-${i}`,
			time: times[i] as MediaTime,
			value: values[i],
			segmentToNext: "linear",
			tangentMode: "auto",
		}));
		animations[path] = { keys };
	});
	return { ...el, params: params as T["params"], animations };
}

/**
 * A layer's In / Out motion (params `motion.*`, see motion.ts) baked into transform keyframes on top of its own
 * (keyframed or still) transform: sampled on the frame grid, simplified within a sub-pixel tolerance, the motion
 * params dropped (so a second pass never adds it twice). Pure; the element itself is unchanged when it has none.
 */
export function bakeMotion<T extends TimelineElement>(el: T, fps = 30): T {
	if (!VISUAL.has(el.type)) return el;
	const params = el.params as Record<string, unknown>;
	const m = readMotion(params);
	if (!m || !(el.duration > 0)) return el;
	const rate = sampleRate(fps);
	const step = TICKS / rate;
	const n = Math.max(2, Math.ceil(el.duration / step - 1e-9) + 1);
	const times = Array.from({ length: n }, (_, i) => Math.min(el.duration, Math.round(i * step)));
	const dur = sec(el.duration);
	const samples: number[] = [];
	for (const t of times) {
		const c = applyMotion(tfAt(el as never, el.startTime + t), motionAt(m, sec(t), dur));
		samples.push(c.x, c.y, c.sx, c.sy, c.rot, c.op);
	}
	const animations: ElementAnimations = { ...(el.animations ?? {}) };
	const next: Record<string, unknown> = withoutMotion(params);
	TF_PATHS.forEach((path, j) => {
		const values = times.map((_, i) => samples[i * 6 + j]);
		let lo = values[0];
		let hi = values[0];
		for (const v of values) {
			if (v < lo) lo = v;
			if (v > hi) hi = v;
		}
		delete animations[path];
		next[path] = values[0];
		if (hi - lo <= TF_TOLERANCE[j]) return;
		animations[path] = {
			keys: simplify(times, values, TF_TOLERANCE[j]).map((i) => ({
				id: `mo${j}-${i}`,
				time: times[i] as MediaTime,
				value: values[i],
				segmentToNext: "linear",
				tangentMode: "auto",
			})) as ScalarAnimationKey[],
		};
	});
	return { ...el, params: next as T["params"], animations };
}

/** True when some clip of these tracks has an In / Out motion (they play through flattening then). */
export function hasMotionLayers(tracks: SceneTracks): boolean {
	for (const t of [...tracks.overlay, tracks.main] as TimelineTrack[]) {
		for (const e of t.elements as TimelineElement[]) if (VISUAL.has(e.type) && readMotion((e as { params?: Record<string, unknown> }).params)) return true;
	}
	return false;
}

const tfParams = (t: Tf) => ({ "transform.positionX": t.x, "transform.positionY": t.y, "transform.scaleX": t.sx, "transform.scaleY": t.sy, "transform.rotate": t.rot, opacity: t.op });

const round3 = (v: number) => Math.round(v * 1000) / 1000;

function itemFrom(el: GraphicElement, owner: string | undefined, parent: ParentTf, rate: number): MontageItem {
	const p = el.params;
	const animated = parent.animated || hasTfAnimation(el);
	const samples = animated ? sampleComposed(el, parent, rate).map(round3) : null;
	const tf = samples
		? { x: samples[0], y: samples[1], sx: samples[2], sy: samples[3], rot: samples[4], op: samples[5] }
		: composeTf(parent.base, tfOf(p as Record<string, unknown>));
	return {
		id: el.id,
		owner,
		kind: el.definitionId.slice(AI_PREFIX.length),
		from: sec(el.startTime),
		dur: sec(el.duration),
		skip: sec(el.trimStart),
		len: sec(el.duration + el.trimStart + el.trimEnd),
		props: propsFromParams(p),
		tf,
		...(samples ? { tfk: { t0: sec(el.trimStart), r: rate, v: samples } } : {}),
		...(el.follow ? { follow: el.follow } : {}),
	};
}

/**
 * Replaces compositions by their inner clips (shifted and trimmed to the composition's range) and pulls the AI
 * layers out into `items`. Pure; depth-limited so a composition can never contain itself.
 */
export function flattenCompositions({
	tracks,
	scenes,
	canvas,
	window,
	depth = 0,
	owner,
	parent = IDENTITY_PARENT,
	fps = 30,
	keepAiLayers = false,
}: {
	tracks: SceneTracks;
	scenes: TScene[];
	canvas?: { width?: number; height?: number };
	window?: Window;
	depth?: number;
	/** The composition clip these tracks belong to (undefined for the timeline being shown). */
	owner?: string;
	/** The composition clip's transform over time (composed down nested compositions): applied to everything inside. */
	parent?: ParentTf;
	/** The timeline's frame rate: keyframed composite transforms are sampled on its frame grid. */
	fps?: number;
	/** Flatten (an old AI composition put onto its timeline): its AI layers stay layers instead of going to `items`. */
	keepAiLayers?: boolean;
}): Flattened {
	const items: MontageItem[] = [];
	const rate = sampleRate(fps);
	const place = <T extends TimelineElement>(el: T) => (window ? placeInWindow(el, window) : el);
	const extraAudio: AudioTrack[] = [];

	const expandTrack = (track: OverlayTrack | VideoTrack): OverlayTrack[] => {
		const out: OverlayTrack[] = [];
		const kept: TimelineElement[] = [];
		const hidden = trackHidden(track);
		for (const raw of track.elements as TimelineElement[]) {
			// The motion is locked to the layer's own start and end (baked before the window cuts it).
			const el = place(bakeMotion(raw, fps));
			if (!el) continue;
			if (isComposition(el)) {
				if (hidden || el.hidden || depth > 3) continue;
				const scene = scenes.find((s) => s.id === el.params.sceneId);
				if (!scene) continue;
				const tf = throughComposition(parent, el);
				const inner = flattenCompositions({
					tracks: scene.tracks,
					scenes,
					canvas,
					depth: depth + 1,
					window: { start: el.startTime, end: el.startTime + el.duration, offset: el.startTime - el.trimStart },
					owner: el.id,
					parent: tf,
					fps,
					keepAiLayers,
				});
				// Inner items on the composition's main track move with that track's renamed copy.
				const mainId = inner.tracks.main.id;
				items.push(...inner.items.map((it) => (it.zTrack === mainId ? { ...it, zTrack: `${mainId}~${el.id}` } : it)));
				out.push(...inner.tracks.overlay, { ...inner.tracks.main, id: `${inner.tracks.main.id}~${el.id}` });
				if (el.params.alpha === false && canvas?.width && canvas?.height) {
					const bg: GraphicElement = {
						id: `${el.id}~bg`,
						type: "graphic",
						name: "Background",
						definitionId: "rectangle",
						startTime: el.startTime,
						duration: el.duration,
						trimStart: 0 as MediaTime,
						trimEnd: 0 as MediaTime,
						params: {
							fill: "#000000",
							"transform.scaleX": canvas.width / 512 + 0.01,
							"transform.scaleY": canvas.height / 512 + 0.01,
						},
					};
					out.push({ ...buildEmptyTrack({ id: `${el.id}~bgtrack`, type: "graphic" }), elements: [throughParent(bg, tf, rate)] });
				}
				extraAudio.push(...inner.tracks.audio);
				continue;
			}
			if (isAiLayer(el) && !keepAiLayers) {
				if (!hidden && !(el as GraphicElement).hidden) items.push({ ...itemFrom(el as GraphicElement, owner, parent, rate), zTrack: track.id });
				continue;
			}
			kept.push(throughParent(el, owner ? parent : undefined, rate));
		}
		return [{ ...track, elements: kept } as OverlayTrack, ...out];
	};

	const overlay: OverlayTrack[] = [];
	for (const t of tracks.overlay) {
		const [self, ...nested] = expandTrack(t);
		overlay.push(self, ...nested);
	}
	const [mainSelf, ...mainNested] = expandTrack(tracks.main);
	overlay.push(...mainNested);
	const audio = tracks.audio.map((t) => ({ ...t, elements: t.elements.map((e) => place(e)).filter(Boolean) })) as AudioTrack[];
	return {
		tracks: { overlay, main: mainSelf as VideoTrack, audio: [...audio, ...extraAudio] },
		items,
	};
}


/** Inside a composition only its own contents play; the video under it is an opt-in ("Show video underneath"). */
export const showsUnderlay = (composition: GraphicElement) => composition.params.underlay === true && composition.params.alpha !== false;

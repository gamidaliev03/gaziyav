// A compound clip's own sound and picture settings, carried down to the clips it plays (owner, 21.11: «звуковые
// настройки применить» to a compound like to any clip). Flattening (flatten.ts) replaces a compound by its inner
// clips; this hands each of them what was set on the compound, so preview and export both get it:
//   sound — mute (and its track's mute) and a still volume baked into the clip's own (dB add); a fade, ducking, pan
//           and audio effects of the compound; keyframed compound volume and its fades travel as an «outer» layer
//           the clip envelope multiplies in (sounds/mix/envelope.ts), over the compound's own place in time.
//   picture — the compound's effects (its Color and Effects tabs) after the clip's own.
// Pure: no editor core, no wasm.
import type { ElementAnimations } from "@/animation/types";
import type { TimelineElement, TimelineTrack } from "@/timeline/types";

/** Params key of the outer layers on a flattened clip (never saved: flattened tracks are made for playback only). */
export const OUTER_MIX = "compound.outerMix";

/** One compound's gain over a clip inside it: its place (ticks, the flattened timeline's time), fades, volume curve. */
export interface OuterMixLayer {
	start: number;
	duration: number;
	fadeIn: number;
	fadeOut: number;
	/** Only when the compound's volume has keyframes: its base dB and the keyframes (ticks from `start`). */
	volume?: { base: number; animations: ElementAnimations };
}

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

const hasKeys = (animations: ElementAnimations | undefined, path: string) => {
	const keys = (animations?.[path] as { keys?: unknown[] } | undefined)?.keys;
	return Array.isArray(keys) && keys.length > 0;
};

const AUDIO_FX_PARAM = /^fx\.[a-z]+$/;

/** True when the compound has any sound setting of its own (else its clips are left exactly as they are). */
export function hasCompoundSound(compound: TimelineElement, trackMuted: boolean): boolean {
	const p = compound.params as Record<string, unknown>;
	return (
		trackMuted ||
		p.muted === true ||
		num(p.volume) !== 0 ||
		num(p.fadeIn) > 0 ||
		num(p.fadeOut) > 0 ||
		p.duckUnderVoice === true ||
		num(p.pan) !== 0 ||
		hasKeys(compound.animations, "volume") ||
		Object.keys(p).some((k) => AUDIO_FX_PARAM.test(k) && p[k] === true)
	);
}

const clampDb = (v: number) => Math.max(-60, Math.min(20, v));
const clampPan = (v: number) => Math.max(-100, Math.min(100, v));

/** A clip inside the compound with the compound's sound on top of its own. */
export function withCompoundSound<T extends TimelineElement>(el: T, compound: TimelineElement, trackMuted: boolean): T {
	if (el.type !== "audio" && el.type !== "video") return el;
	const c = compound.params as Record<string, unknown>;
	const params: Record<string, unknown> = { ...(el.params as Record<string, unknown>) };
	if (trackMuted || c.muted === true) params.muted = true;
	const animatedVolume = hasKeys(compound.animations, "volume");
	if (!animatedVolume && num(c.volume) !== 0) params.volume = clampDb(num(params.volume) + num(c.volume));
	if (c.duckUnderVoice === true && params.voiceRole !== "yes") params.duckUnderVoice = true;
	if (num(c.pan) !== 0 && !hasKeys(el.animations, "pan")) params.pan = clampPan(num(params.pan) + num(c.pan));
	// the compound's audio effects on every clip that doesn't have that effect itself (its settings with it)
	for (const [k, v] of Object.entries(c)) {
		if (!AUDIO_FX_PARAM.test(k) || v !== true || params[k] === true) continue;
		params[k] = true;
		for (const [sk, sv] of Object.entries(c)) if (sk.startsWith(`${k}.`)) params[sk] = sv;
	}
	if (num(c.fadeIn) > 0 || num(c.fadeOut) > 0 || animatedVolume) {
		const layer: OuterMixLayer = {
			start: compound.startTime,
			duration: compound.duration,
			fadeIn: Math.max(0, num(c.fadeIn)),
			fadeOut: Math.max(0, num(c.fadeOut)),
			...(animatedVolume ? { volume: { base: num(c.volume), animations: { volume: compound.animations?.volume } as ElementAnimations } } : {}),
		};
		params[OUTER_MIX] = [...readOuterMix(params), layer];
	}
	return { ...el, params: params as T["params"] };
}

/** The outer layers on a flattened clip (none on a clip of the timeline itself). */
export function readOuterMix(params: Record<string, unknown> | undefined): OuterMixLayer[] {
	const list = params?.[OUTER_MIX];
	return Array.isArray(list) ? (list as OuterMixLayer[]) : [];
}

const VISUAL_TYPES = ["video", "image", "text", "sticker", "graphic"];
const isSet = (v: unknown) => typeof v === "string" && v !== "" && v !== "none";

/** True when the compound has a picture setting the renderer only sees on its clips (effects, In / Out / Loop, shadow). */
export function hasCompoundPicture(compound: TimelineElement): boolean {
	const p = compound.params as Record<string, unknown>;
	const fx = (compound as { effects?: unknown[] }).effects;
	return (Array.isArray(fx) && fx.length > 0) || isSet(p["anim.in"]) || isSet(p["anim.out"]) || isSet(p["anim.loop"]) || p["shadow.enabled"] === true;
}

/**
 * The compound's picture on a clip inside it: its effects (Color and Effects tabs) after the clip's own; its In
 * animation on the clips it starts with, its Out on the ones it ends with, its Loop on all (each clip keeps its own);
 * its drop shadow on the clips without one.
 */
export function withCompoundPicture<T extends TimelineElement>(el: T, compound: TimelineElement): T {
	if (!VISUAL_TYPES.includes(el.type)) return el;
	let out = el;
	const fx = (compound as { effects?: unknown[] }).effects;
	if (Array.isArray(fx) && fx.length > 0) {
		const own = (el as { effects?: { id?: string }[] }).effects ?? [];
		const ids = new Set(own.map((e) => e.id));
		const added = (fx as { id?: string }[]).filter((e) => !ids.has(e.id)).map((e) => ({ ...e, id: `${e.id}~${compound.id}` }));
		out = { ...out, effects: [...own, ...added] } as T;
		// the compound's effect keyframes (`effects.<id>.params.<key>`, compound time) follow, in the clip's own time
		const shift = compound.startTime - el.startTime;
		const moved: Record<string, unknown> = {};
		for (const e of added) {
			const from = `effects.${e.id?.slice(0, -(compound.id.length + 1))}.`;
			for (const [pathKey, channel] of Object.entries(compound.animations ?? {})) {
				if (!pathKey.startsWith(from) || !channel) continue;
				const keys = (channel as { keys?: { time: number }[] }).keys;
				moved[`effects.${e.id}.${pathKey.slice(from.length)}`] = Array.isArray(keys) ? { ...channel, keys: keys.map((k) => ({ ...k, time: k.time + shift })) } : channel;
			}
		}
		if (Object.keys(moved).length > 0) out = { ...out, animations: { ...(out.animations ?? {}), ...moved } as ElementAnimations };
	}
	const c = compound.params as Record<string, unknown>;
	const params: Record<string, unknown> = { ...(out.params as Record<string, unknown>) };
	let changed = false;
	const copy = (keys: string[]) => {
		for (const k of keys) if (c[k] !== undefined) params[k] = c[k];
		changed = true;
	};
	const tick = 1;
	if (isSet(c["anim.in"]) && !isSet(params["anim.in"]) && el.startTime <= compound.startTime + tick) copy(["anim.in", "anim.inDuration"]);
	if (isSet(c["anim.out"]) && !isSet(params["anim.out"]) && el.startTime + el.duration >= compound.startTime + compound.duration - tick) copy(["anim.out", "anim.outDuration"]);
	if (isSet(c["anim.loop"]) && !isSet(params["anim.loop"])) copy(["anim.loop", "anim.loopDuration"]);
	if (c["shadow.enabled"] === true && params["shadow.enabled"] !== true) copy(Object.keys(c).filter((k) => k.startsWith("shadow.")));
	return changed ? ({ ...out, params: params as T["params"] } as T) : out;
}

/** Whether a track of the timeline being flattened is muted (a compound on it is silent too). */
export const isTrackMuted = (track: TimelineTrack) => "muted" in track && track.muted === true;

// Gaziyav AI's hands: every tool is a thin call into the same editor code the buttons use (commands with ⌘Z,
// the job center, on-device models), so what the agent does looks and undoes exactly like a manual edit.
// Times are seconds on the timeline; elements and media are addressed by the short ids get_project prints.
import { invokeAction } from "@/actions";
import { generateUUID } from "@/utils/id";
import { applyDubText, translateClipSpeech } from "@/assist/dub";
import { autoColor } from "@/assist/auto-color";
import { markBeats } from "@/assist/beat-markers";
import { DUB_LANGUAGES } from "@/assist/languages";
import { splitScenes } from "@/assist/scenes";
import { EditorCore } from "@/core";
import { compoundLength, mediaCompounds, placeMediaCompound } from "@/timeline/media-compounds";
import { effectsRegistry } from "@/effects";
import { floatToFrameRate, frameRateToFloat } from "@/fps/utils";
import { FACES, faceSwapClip } from "@/faceswap/run";
import { generate } from "@/generate/run";
import { VOICES } from "@/generate/voices";
import { formatBytes, useOndeviceStore } from "@/ondevice/client";
import { useJobsStore } from "@/jobs/store";
import { buildLibraryClip } from "@/library/client";
import { type LibraryIndex, libraryFileUrl } from "@/library/types";
import { userFileAt } from "@/media/originals";
import { processMediaAssets } from "@/media/processing";
import type { MediaAsset } from "@/media/types";
import { designLayerPreset, insertUserTextPreset } from "@/presets/actions";
import { useUserPresets } from "@/presets/user-presets";
import { MOTION_KEYS } from "@/montage/motion";
import { reframeClips, renderSmooth, toggleReverse, trackClip } from "@/motion/client";
import { ASPECTS, type AspectId, attachFollower, detachFollower } from "@/motion/commands";
import { freezeFrame } from "@/motion/freeze";
import { DEFAULT_FX } from "@/motion/tracker";
import type { TrackerKind } from "@/motion/types";
import { applyToClip } from "@/neural/apply";
import type { NeuralFamilyId } from "@/neural/catalog";
import type { ParamValue } from "@/params";
import { getElementParam, getElementParams, readElementParamValue, writeElementParamValue } from "@/params/registry";
import { removePausesInClip } from "@/silence/clip";
import { chosenModel as studioLipsyncModel, lipsync, voiceover, voiceOnly } from "@/studio/client/actions";
import { studioApi, uploadOnce } from "@/studio/client/api";
import { audioUnder, setVoiceFromAsset, setVoiceFromTimeline } from "@/studio/client/voice-timeline";
import { currentClip, placeGenerated } from "@/studio/client/editor-bridge";
import { useStudioStore } from "@/studio/client/studio-store";
import { downloadFragment, fragmentError } from "@/studio/client/actions";
import { insertCaptionChunksAsTextTrack } from "@/subtitles/insert";
import type { CaptionStyleId } from "@/subtitles/styles";
import type { Bookmark, TimelineElement, TimelineTrack, VideoElement } from "@/timeline";
import { buildElementFromMedia, buildTextElement } from "@/timeline/element-utils";
import { generateLocalCaptions } from "@/transcribe/captions";
import { transcribeTimeline } from "@/transcribe/timeline";
import { applyCuts } from "@/silence/remove";
import { applyTransition, findNearestCut } from "@/transitions/commands";
import { mainIndexAt, overlapsOnMain, reorderMainTrack } from "@/timeline/main-order";
import { ALL_TRANSITIONS } from "@/transitions/definitions";
import { mediaTimeFromSeconds, TICKS_PER_SECOND } from "@/wasm";
import { THIS_COMPUTER } from "@/utils/platform";
import { canSee, lookAt, lookAtMedia, lookAtTimeline, watch } from "./vision";
import { cutOutSeamless, HEAR_TOOLS, hearTranscript, seamlessTime } from "./hear-tools";
import { PRODUCE_STEP_LABELS, PRODUCE_TOOLS, rememberSync } from "./produce-tools";
import { SEAM_FADE } from "@/hear/cuts";
import { type PointInput, pointModels, pointReference, pointUpload, resultToMedia, usePoint } from "@/cloud/client";
import { useGraphicsLibrary } from "@/graphics/lottie/library";
import { insertGraphic } from "@/stickers/insert-graphic";
import { TEXT_PRESETS } from "@/text/presets";
import { buildPresetElement } from "@/text/insert-preset";
import { estimatePoint } from "@/cloud/client";
import { falTts, keysOf, unitPrice, useFal } from "@/fal/client";
import { apiOf, chosenModel, type FalModel, falModel, modelsFor, price, usd } from "@/fal/models";
import type { AiApi } from "@/fal/video";
import { buildDefaultMaskInstance } from "@/masks";
import type { MaskType } from "@/masks/types";
import { API_LABEL, blockedApis, budgetLine, charged, cheapestOf, cloudModelsFor, gate, readBudget, underBudget } from "@/mcp/money";
import { castOf, readMemory } from "@/mcp/notes";
import { forClaude, lateLine, missingInputs } from "@/cloud/claude-words";
import { AUDIO_FX, EQ_PRESETS } from "@/sounds/mix/fx";
import { LIPSYNC_TAIL_SECONDS } from "@/studio/shared/models";

export interface ToolSpec {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

type Args = Record<string, unknown>;
type Run = (args: Args, signal: AbortSignal) => Promise<unknown>;

const editor = () => EditorCore.getInstance();
const sec = (ticks: number) => Math.round((ticks / TICKS_PER_SECOND) * 100) / 100;
const at = (seconds: unknown) => mediaTimeFromSeconds({ seconds: Math.max(0, Number(seconds) || 0) });
const short = (id: string) => id.slice(0, 8);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class ToolError extends Error {}
const fail = (message: string): never => {
	throw new ToolError(message);
};

function projectId(): string {
	return editor().project.getActiveOrNull()?.metadata.id ?? fail("No project is open.");
}

function tracks(): TimelineTrack[] {
	const t = editor().scenes.getActiveScene().tracks;
	return [...t.overlay, t.main, ...t.audio] as TimelineTrack[];
}

interface Found {
	track: TimelineTrack;
	element: TimelineElement;
}

function find(id: unknown): Found {
	const key = String(id ?? "").trim();
	if (!key) fail("Give the element id (from get_project).");
	for (const track of tracks()) {
		for (const element of track.elements as TimelineElement[]) {
			if (element.id === key || element.id.startsWith(key)) return { track, element };
		}
	}
	return fail(`No element "${key}" on the timeline. Call get_project for the current ids.`);
}

function findVideo(id: unknown): Found & { element: VideoElement } {
	const f = find(id);
	if (f.element.type !== "video") fail(`"${short(f.element.id)}" is ${f.element.type}, this needs a video clip.`);
	return f as Found & { element: VideoElement };
}

function visibleMedia(): MediaAsset[] {
	return editor()
		.media.getAssets()
		.filter((a) => !a.ephemeral && !a.motionProxy);
}

function findMedia(id: unknown): MediaAsset {
	const key = String(id ?? "").trim();
	return (
		visibleMedia().find((a) => a.id === key || a.id.startsWith(key)) ?? fail(`No media "${key}". Call get_project for the media list.`)
	);
}

function select(refs: Found[]) {
	editor().selection.setSelectedElements({ elements: refs.map((f) => ({ trackId: f.track.id, elementId: f.element.id })) });
}

function ids(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String);
	if (typeof value === "string" && value.trim()) return value.split(/[\s,]+/).filter(Boolean);
	return [];
}

/** Ids of all elements now, to find the ones a command just added. */
function snapshotIds(): Set<string> {
	return new Set(tracks().flatMap((t) => (t.elements as TimelineElement[]).map((e) => e.id)));
}

function addedSince(before: Set<string>): Found[] {
	const out: Found[] = [];
	for (const track of tracks()) for (const element of track.elements as TimelineElement[]) if (!before.has(element.id)) out.push({ track, element });
	return out;
}

/**
 * Runs an editor action that reports through the job center (AI effects, tracking, lipsync…) and waits for every
 * job it started, so the agent learns how it ended instead of guessing.
 */
async function settle(work: () => unknown, signal: AbortSignal, maxMinutes = 30) {
	const before = new Set(useJobsStore.getState().jobs.map((j) => j.id));
	const tracksBefore = editor().scenes.getActiveScene().tracks;
	const value = await work();
	await sleep(400);
	const t0 = Date.now();
	for (;;) {
		const mine = useJobsStore.getState().jobs.filter((j) => !before.has(j.id));
		const running = mine.filter((j) => j.status === "running");
		if (signal.aborted) {
			for (const j of running) j.cancel?.();
			throw new DOMException("Stopped", "AbortError");
		}
		if (!running.length || Date.now() - t0 > maxMinutes * 60_000) {
			const failed = mine.find((j) => j.status === "error");
			if (failed) fail(`${failed.title}: ${failed.message ?? "failed"}`);
			return {
				value,
				jobs: mine.map((j) => `${j.title}: ${j.status === "running" ? "still running in the background" : (j.message ?? j.status)}`),
				timelineChanged: editor().scenes.getActiveScene().tracks !== tracksBefore,
			};
		}
		await sleep(600);
	}
}

// ───────────────────────── reading the project ─────────────────────────

function describe(track: TimelineTrack, element: TimelineElement) {
	const e = element as TimelineElement & Record<string, unknown>;
	const out: Record<string, unknown> = {
		id: short(element.id),
		type: element.type,
		name: element.name,
		start: sec(element.startTime),
		end: sec(element.startTime + element.duration),
	};
	if (element.type === "text") out.text = String(element.params.content ?? "").slice(0, 120);
	if ("mediaId" in e && e.mediaId) out.media = short(String(e.mediaId));
	if (element.type === "video" || element.type === "audio") {
		out.sourceFrom = sec(element.trimStart);
		const rate = element.retime?.rate ?? 1;
		if (rate !== 1 || element.retime?.mode === "curve") out.speed = element.retime?.mode === "curve" ? "curve" : rate;
		if (element.params.volume !== undefined && element.params.volume !== 0) out.volumeDb = element.params.volume;
		if (element.params.muted) out.muted = true;
	}
	if (element.type === "video" && element.reversed) out.reversed = true;
	if (element.type === "video" && element.trackers?.length) out.trackers = element.trackers.map((t) => `${t.id.slice(0, 6)}:${t.kind}`);
	const effects = (e.effects as Array<{ type: string; enabled: boolean }> | undefined) ?? [];
	if (effects.length) out.effects = effects.map((f) => effectsRegistry.has(f.type) ? effectsRegistry.get(f.type).name : f.type);
	if (e.hidden) out.hidden = true;
	if (element.type === "graphic") out.graphic = element.definitionId;
	if (element.type === "effect") out.effect = element.effectType;
	if (track.type === "video" && Array.isArray((track as { transitions?: unknown[] }).transitions)) {
		const tr = ((track as { transitions?: Array<{ type: string; toElementId: string }> }).transitions ?? []).find((t) => t.toElementId === element.id);
		if (tr) out.transitionIn = tr.type;
	}
	return out;
}

/** The project as data (Claude's connector makes its own short view of it: every media item, no cut). */
export const projectData = (mediaLimit = 60) => getProject(mediaLimit);

function getProject(mediaLimit = 60) {
	const ed = editor();
	const project = ed.project.getActiveOrNull() ?? fail("No project is open.");
	const scene = ed.scenes.getActiveScene();
	const t = scene.tracks;
	const list = [
		...t.overlay.map((track, i) => ({ track: track as TimelineTrack, role: `overlay ${i + 1} (top=1)` })),
		{ track: t.main as TimelineTrack, role: "main video" },
		...t.audio.map((track, i) => ({ track: track as TimelineTrack, role: `audio ${i + 1}` })),
	];
	let count = 0;
	const trackInfo = list.map(({ track, role }) => {
		const elements = (track.elements as TimelineElement[]).slice().sort((a, b) => a.startTime - b.startTime);
		count += elements.length;
		return {
			id: short(track.id),
			role,
			type: track.type,
			...("muted" in track && track.muted ? { muted: true } : {}),
			...("hidden" in track && track.hidden ? { hidden: true } : {}),
			elements: elements.slice(0, 120).map((e) => describe(track, e)),
			...(elements.length > 120 ? { more: elements.length - 120 } : {}),
		};
	});
	const onTimeline = new Set(tracks().flatMap((tr) => (tr.elements as Array<{ mediaId?: string }>).map((e) => e.mediaId).filter(Boolean)));
	const selected = ed.selection.getSelectedElements().map((r) => short(r.elementId));
	return {
		project: {
			name: project.metadata.name,
			width: project.settings.canvasSize.width,
			height: project.settings.canvasSize.height,
			fps: Math.round(frameRateToFloat(project.settings.fps) * 100) / 100,
			duration: sec(ed.timeline.getTotalDuration()),
			playhead: sec(ed.playback.getCurrentTime()),
			composition: scene.isMain ? undefined : scene.name,
		},
		selected,
		tracks: trackInfo,
		elementCount: count,
		media: visibleMedia()
			.slice(-mediaLimit)
			.map((a) => ({
				id: short(a.id),
				name: a.name,
				type: a.type,
				...(a.duration ? { duration: Math.round(a.duration * 100) / 100 } : {}),
				...(a.width ? { size: `${a.width}x${a.height}` } : {}),
				...(onTimeline.has(a.id) ? { onTimeline: true } : {}),
				...(a.origin === "result" ? { made: true } : {}),
			})),
		// an older project's extra timelines, now compound clips in Media (timeline/media-compounds.ts): add_media places one
		...mediaCompoundList(ed),
	};
}

/** Media's compound clips as media items of type "compound"; no tool names a timeline any more. */
function mediaCompoundList(ed: EditorCore): { compounds?: Array<{ id: string; name: string; type: "compound"; duration: number }> } {
	const list = mediaCompounds(ed.scenes.getScenes()).map((s) => ({ id: short(s.id), name: s.name, type: "compound" as const, duration: sec(compoundLength(s)) }));
	return list.length ? { compounds: list } : {};
}

function getElement(args: Args) {
	const { track, element } = find(args.id);
	const params = getElementParams({ element }).map((p) => {
		const value = readElementParamValue({ element, param: p });
		const d = p as { min?: number; max?: number; options?: Array<{ value: string }> };
		return {
			key: p.key,
			label: p.label,
			type: p.type,
			value,
			...(d.min !== undefined && d.min > -1000 ? { min: d.min } : {}),
			...(d.max !== undefined ? { max: d.max } : {}),
			...(d.options ? { options: d.options.map((o) => o.value) } : {}),
		};
	});
	const e = element as TimelineElement & { effects?: Array<{ id: string; type: string; enabled: boolean; params: Record<string, ParamValue> }> };
	return {
		...describe(track, element),
		track: short(track.id),
		params,
		effects: (e.effects ?? []).map((f) => ({ id: f.id.slice(0, 8), type: f.type, enabled: f.enabled, params: f.params })),
		...(element.type === "video" || element.type === "audio" ? { retime: element.retime ?? { rate: 1 } } : {}),
	};
}

// ───────────────────────── editing ─────────────────────────

function coerce(type: string, value: unknown): ParamValue {
	if (type === "number") {
		const n = Number(value);
		if (!Number.isFinite(n)) fail(`Expected a number, got ${JSON.stringify(value)}`);
		return n;
	}
	if (type === "boolean") return value === true || value === "true" || value === 1;
	return String(value ?? "");
}

const MOTION_PARAM_KEYS = new Set<string>(Object.values(MOTION_KEYS));

/** «+=3», «-=3», «*=1.2»: relative to the value it has now (a title 20 % bigger, the music 3 dB quieter). */
function relative(raw: unknown, current: unknown): unknown {
	const m = typeof raw === "string" ? /^([+\-*])=\s*(-?\d+(?:\.\d+)?)\s*(%?)$/.exec(raw.trim()) : null;
	if (!m) return raw;
	const now = Number(current) || 0;
	const n = Number(m[2]) * (m[3] ? 0.01 : 1);
	return m[1] === "*" ? now * (m[3] ? 1 + n : n) : m[1] === "+" ? now + (m[3] ? now * n : n) : now - (m[3] ? now * n : n);
}

function setElement(args: Args) {
	// Several elements at once (all the captions, every clip): one ⌘Z for all of them.
	const many = ids(args.ids);
	if (many.length > 1 || (many.length === 1 && !args.id)) {
		const updates = many.map((id) => elementPatch(find(id), args)).filter((u): u is NonNullable<typeof u> => !!u);
		if (!updates.length) return "Nothing to change.";
		editor().timeline.updateElements({ updates });
		return `Updated ${updates.length}: ${updates.map((u) => short(u.elementId)).join(", ")}.`;
	}
	const found = find(args.id);
	const update = elementPatch(found, args);
	if (!update) return "Nothing to change.";
	editor().timeline.updateElements({ updates: [update] });
	return `Updated ${short(found.element.id)}.`;
}

function elementPatch(found: Found, args: Args): { trackId: string; elementId: string; patch: Partial<TimelineElement> } | null {
	let next: TimelineElement = found.element;
	const unknown: string[] = [];
	const params = (args.params ?? {}) as Record<string, unknown>;
	// get_project shows the volume as volumeDb: the same name is accepted back.
	const ALIASES: Record<string, string> = { volumeDb: "volume" };
	for (const [given, raw] of Object.entries(params)) {
		const key = ALIASES[given] ?? given;
		// The hand-made In / Out motion (src/montage/motion.ts) is plain params, not registry ones.
		if (MOTION_PARAM_KEYS.has(key) && "params" in next && (typeof raw === "string" || typeof raw === "number")) {
			next = { ...next, params: { ...next.params, [key]: raw } } as TimelineElement;
			continue;
		}
		// An audio effect's own settings (Inspector → Audio → its card): fx.<effect>.<setting>, the EQ's bands by preset.
		const fx = /^fx\.([a-z]+)\.([A-Za-z]+)$/.exec(key);
		if (fx && "params" in next) {
			const def = AUDIO_FX.find((d) => d.id === fx[1]);
			if (!def) fail(`No audio effect "${fx[1]}". Effects: ${AUDIO_FX.map((d) => d.id).join(", ")}.`);
			let value: ParamValue;
			if (fx[2] === "bands") {
				const preset = EQ_PRESETS.find((p) => p.id === String(raw));
				const bands = preset ? preset.bands : Array.isArray(raw) ? raw : fail(`fx.voice.bands: a preset (${EQ_PRESETS.map((p) => p.id).join(", ")}) or a list of {type, f, g, q}.`);
				value = JSON.stringify(bands);
			} else {
				const spec = def!.params.find((p) => p.key === fx[2]) ?? fail(`${def!.label} has no setting "${fx[2]}". Settings: ${def!.params.map((p) => p.key).join(", ") || "none"}.`);
				value = Math.min(spec!.max, Math.max(spec!.min, Number(raw)));
				if (!Number.isFinite(value)) fail(`${key}: a number from ${spec!.min} to ${spec!.max}.`);
			}
			next = { ...next, params: { ...next.params, [key]: value, [def!.param]: true } } as TimelineElement;
			continue;
		}
		// A mask (Inspector → Mask): one per clip, its shape, then its settings (mask.feather, mask.inverted…).
		if ((key === "mask" || key.startsWith("mask.")) && "masks" in next) {
			const masks = ((next as { masks?: Array<{ id: string; type: string; params: Record<string, unknown> }> }).masks ?? []).slice();
			if (key === "mask") {
				const type = String(raw);
				if (type === "none" || type === "") next = { ...next, masks: [] } as TimelineElement;
				else {
					try {
						next = { ...next, masks: [buildDefaultMaskInstance({ maskType: type as MaskType })] } as TimelineElement;
					} catch {
						fail(`No mask "${type}": rectangle, ellipse, heart, diamond, star, split, cinematic-bars, text, or none.`);
					}
				}
				continue;
			}
			const first = masks[0] ?? fail("Give the mask first: {mask:\"ellipse\"}, then its settings.");
			const sub = key.slice(5);
			masks[0] = { ...first!, params: { ...first!.params, [sub]: typeof raw === "number" || typeof raw === "boolean" ? raw : Number.isFinite(Number(raw)) && String(raw).trim() !== "" ? Number(raw) : raw } };
			next = { ...next, masks } as unknown as TimelineElement;
			continue;
		}
		const param = getElementParam({ element: next, key });
		if (!param) {
			unknown.push(given);
			continue;
		}
		let value = coerce(param.type, param.type === "number" ? relative(raw, readElementParamValue({ element: next, param })) : raw);
		const d = param as { min?: number; max?: number };
		if (typeof value === "number") value = Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, value));
		next = writeElementParamValue({ element: next, param, value });
	}
	if (unknown.length) {
		const valid = getElementParams({ element: found.element }).map((p) => p.key);
		fail(`Unknown parameter(s) ${unknown.join(", ")} for ${found.element.type}. Valid: ${valid.join(", ")}`);
	}
	const patch: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(next)) if ((found.element as unknown as Record<string, unknown>)[k] !== v) patch[k] = v;
	if (typeof args.name === "string" && args.name.trim()) patch.name = args.name.trim();
	if (args.hidden !== undefined && "hidden" in found.element) patch.hidden = !!args.hidden;
	if (!Object.keys(patch).length) return null;
	return { trackId: found.track.id, elementId: found.element.id, patch: patch as Partial<TimelineElement> };
}

function moveElement(args: Args) {
	const found = find(args.id);
	const ed = editor();
	let targetTrackId = found.track.id;
	// A new track is created by the move itself (as a drag onto a new track does): added on its own first, the empty
	// track was cleaned away before the move and the move failed with "Target track not found".
	let createTracks: Array<{ id: string; type: TimelineTrack["type"]; index: number }> | undefined;
	if (args.track === "new") {
		targetTrackId = generateUUID();
		createTracks = [{ id: targetTrackId, type: found.track.type, index: 0 }];
	} else if (args.track) {
		const key = String(args.track);
		const target = tracks().find((t) => t.id === key || t.id.startsWith(key)) ?? fail(`No track "${key}".`);
		if (target.type !== found.track.type && !(target.type === "video" && (found.element.type === "image" || found.element.type === "video")))
			fail(`A ${found.element.type} can't go on a ${target.type} track.`);
		targetTrackId = target.id;
	}
	const start = args.start === undefined ? found.element.startTime : at(args.start);
	// The main track is magnetic: a clip moved onto another one changes the order (like a drag), it doesn't collide.
	const main = ed.scenes.getActiveScene().tracks.main;
	if (args.start !== undefined && found.track.id === main.id && targetTrackId === main.id && overlapsOnMain(ed, found.element.id, start, found.element.duration)) {
		const order = reorderMainTrack(ed, found.element.id, mainIndexAt(ed, found.element.id, start));
		const placed = order.find((e) => e.id === found.element.id);
		return `Moved ${short(found.element.id)} to ${sec(placed?.startTime ?? start)} s; the main track order is now ${order.map((e) => e.name).join(" → ")}.`;
	}
	ed.timeline.moveElements({ moves: [{ sourceTrackId: found.track.id, targetTrackId, elementId: found.element.id, newStartTime: start }], createTracks });
	// Where it really is now (the answer used to repeat the time asked: «Moved to 26.9 s» for a clip that stayed at 7.7).
	const now = tracks().flatMap((t) => (t.elements as TimelineElement[]).map((e) => ({ t, e }))).find((x) => x.e.id === found.element.id);
	const real = now ? now.e.startTime : start;
	if (Math.abs(real - start) > TICKS_PER_SECOND / 50) {
		const onMain = now?.t.id === ed.scenes.getActiveScene().tracks.main.id;
		return `Not at ${sec(start)} s: ${short(found.element.id)} is at ${sec(real)} s${onMain ? " — the main track has no gaps (clips stand one after another). For a free place move it to a track above: {track:\"new\"}" : ""}.`;
	}
	return `Moved ${short(found.element.id)} to ${sec(real)} s.`;
}

async function splitAt(args: Args, signal: AbortSignal) {
	// Seamless (hear-tools.ts): a time inside a word or breath of a clip already heard moves into the nearest pause; frame-exact.
	const snapped = await seamlessTime(Number(args.time), args.exact === true, signal);
	const time = at(snapped.at);
	const list = ids(args.ids);
	const targets = list.length
		? list.map(find)
		: tracks().flatMap((track) =>
				(track.elements as TimelineElement[]).filter((e) => e.startTime < time && e.startTime + e.duration > time).map((element) => ({ track, element })),
			);
	const inside = targets.filter((f) => f.element.startTime < time && f.element.startTime + f.element.duration > time);
	if (!inside.length) fail(`Nothing to split at ${sec(time)} s.`);
	const right = editor().timeline.splitElements({ elements: inside.map((f) => ({ trackId: f.track.id, elementId: f.element.id })), splitTime: time });
	return { split: inside.map((f) => short(f.element.id)), newRightParts: right.map((r) => short(r.elementId)), at: Number(snapped.at.toFixed(3)), ...(snapped.note ? { moved: snapped.note } : {}) };
}

async function trimElement(args: Args, signal: AbortSignal) {
	let found = find(args.id);
	const ed = editor();
	const s0 = found.element.startTime;
	const s1 = s0 + found.element.duration;
	// Seamless (hear-tools.ts): new edges in pauses of a clip already heard, frame-exact, 30 ms sound fades on them.
	const exact = args.exact === true;
	const startSnap = args.start !== undefined ? await seamlessTime(Number(args.start), exact, signal, found.element.id) : null;
	const endSnap = args.end !== undefined ? await seamlessTime(Number(args.end), exact, signal, found.element.id) : null;
	// An edge the snapping moved out of the clip (or onto its own edge) is cut where asked instead, and the answer says so;
	// an asked time outside the clip trims nothing on that side.
	const why: string[] = [];
	const inside = (t: number) => t > s0 && t < s1;
	const fps = frameRateToFloat(ed.project.getActive().settings.fps) || 30;
	for (const [side, snap, asked] of [["start", startSnap, args.start], ["end", endSnap, args.end]] as const) {
		if (!snap) continue;
		const want = Number(asked);
		if (!inside(at(want))) {
			why.push(`${side} ${want.toFixed(2)} s is outside the clip (${sec(s0)}–${sec(s1)} s)`);
			continue;
		}
		if (!inside(at(snap.at))) {
			snap.at = Math.round(want * fps) / fps;
			snap.note = `the pause near ${want.toFixed(2)} s lies outside the clip: cut at ${snap.at.toFixed(2)} s exactly`;
		}
	}
	if (!exact && (found.element.type === "video" || found.element.type === "audio")) {
		const p = found.element.params as Record<string, unknown>;
		const fades: Record<string, number> = {};
		if (startSnap && at(startSnap.at) > s0 && !(Number(p.fadeIn) >= SEAM_FADE)) fades.fadeIn = SEAM_FADE;
		if (endSnap && at(endSnap.at) < s1 && !(Number(p.fadeOut) >= SEAM_FADE)) fades.fadeOut = SEAM_FADE;
		if (Object.keys(fades).length) ed.timeline.updateElements({ updates: [{ trackId: found.track.id, elementId: found.element.id, patch: { params: { ...p, ...fades } } as Partial<TimelineElement> }] });
		found = find(found.element.id);
	}
	if (startSnap) {
		const t = at(startSnap.at);
		if (t > s0 && t < s1) {
			const [right] = ed.timeline.splitElements({ elements: [{ trackId: found.track.id, elementId: found.element.id }], splitTime: t, retainSide: "right" });
			if (right) found = find(right.elementId);
		}
	}
	if (endSnap) {
		const t = at(endSnap.at);
		const e0 = found.element.startTime;
		const e1 = e0 + found.element.duration;
		if (t > e0 && t < e1) ed.timeline.splitElements({ elements: [{ trackId: found.track.id, elementId: found.element.id }], splitTime: t, retainSide: "left" });
	}
	const now = find(found.element.id);
	if (args.closeGap && now.element.startTime > s0) moveElement({ id: now.element.id, start: sec(s0) });
	const final = find(found.element.id);
	const moved = [startSnap?.note, endSnap?.note].filter(Boolean);
	// Nothing trimmed is not a success: say why, so the next call can be right.
	if (final.element.startTime === s0 && final.element.startTime + final.element.duration === s1 && !(args.closeGap && now.element.startTime > s0)) fail(`Nothing trimmed: ${[...why, ...moved].join("; ") || "the new edges are the clip's own"}. The clip is ${sec(s0)}–${sec(s1)} s: give start / end inside it (exact:true cuts exactly there).`);
	return { id: short(final.element.id), start: sec(final.element.startTime), end: sec(final.element.startTime + final.element.duration), ...(moved.length || why.length ? { moved: [...moved, ...why].join("; ") } : {}) };
}

function deleteElements(args: Args) {
	const list = ids(args.ids).map(find);
	if (!list.length) fail("Give the ids to delete.");
	if (args.closeGap) {
		// (the ripple delete works on the selection: the user's own selection comes back after, minus what went)
		const kept = editor().selection.getSelectedElements();
		select(list);
		(invokeAction as (action: string) => void)("ripple-delete");
		const gone = new Set(list.map((f) => f.element.id));
		editor().selection.setSelectedElements({ elements: kept.filter((r) => !gone.has(r.elementId)) });
	} else {
		editor().timeline.deleteElements({ elements: list.map((f) => ({ trackId: f.track.id, elementId: f.element.id })) });
	}
	return `Deleted ${list.length}.`;
}

function duplicate(args: Args) {
	const list = ids(args.ids).map(find);
	if (!list.length) fail("Give the ids to duplicate.");
	const out = editor().timeline.duplicateElements({ elements: list.map((f) => ({ trackId: f.track.id, elementId: f.element.id })) });
	return { copies: out.map((r) => short(r.elementId)) };
}

function addMedia(args: Args) {
	const key = String(args.media ?? "").trim();
	const compound = key ? mediaCompounds(editor().scenes.getScenes()).find((s) => s.id === key || s.id.startsWith(key)) : undefined;
	if (compound) {
		const before = snapshotIds();
		if (!placeMediaCompound(editor(), compound.id, args.start === undefined ? undefined : at(args.start) / TICKS_PER_SECOND))
			fail(`Compound clip "${compound.name}" can't go on this timeline (it is this one, or plays it).`);
		const added = addedSince(before)[0];
		return added ? describe(added.track, added.element) : "Added.";
	}
	const asset = findMedia(args.media);
	const ed = editor();
	const before = snapshotIds();
	const seconds = args.duration !== undefined ? Number(args.duration) : (asset.duration ?? 5);
	const element = buildElementFromMedia({
		mediaId: asset.id,
		mediaType: asset.type,
		name: asset.name,
		duration: mediaTimeFromSeconds({ seconds: Math.max(0.1, seconds) }),
		startTime: args.start === undefined ? ed.playback.getCurrentTime() : at(args.start),
	});
	if (asset.type !== "image" && (args.sourceFrom !== undefined || (args.duration !== undefined && asset.duration))) {
		// A piece of the file, inside the file (tlfix B): the clip's source is the whole file — it was the length asked
		// for, so 2 s from 1 s of a 2 s file showed 1…3 s of it (INVARIANT source-bounds in the connect run). The start
		// stays a frame before the end at most, the length what is left after it.
		const full = mediaTimeFromSeconds({ seconds: asset.duration ?? seconds });
		const fps = ed.project.getActive().settings.fps;
		const frame = mediaTimeFromSeconds({ seconds: fps.denominator / fps.numerator });
		const from = Math.max(0, Math.min(args.sourceFrom !== undefined ? at(args.sourceFrom) : 0, full - frame));
		element.trimStart = from as typeof element.trimStart;
		element.duration = Math.min(element.duration, Math.max(1, full - from)) as typeof element.duration;
		element.trimEnd = Math.max(0, full - from - element.duration) as typeof element.trimEnd;
		if ("sourceDuration" in element) element.sourceDuration = full as typeof element.sourceDuration;
	}
	const main = editor().scenes.getActiveScene().tracks.main;
	const placement =
		args.track === "main" && asset.type !== "audio" ? { mode: "explicit" as const, trackId: main.id } : { mode: "auto" as const };
	ed.timeline.insertElement({ element, placement });
	const added = addedSince(before)[0];
	return added ? describe(added.track, added.element) : "Added.";
}

function addText(args: Args) {
	const ed = editor();
	const before = snapshotIds();
	const params: Record<string, ParamValue> = { content: String(args.text ?? "").slice(0, 2000) };
	if (!params.content) fail("Give the text.");
	// The Text panel's titles are 5; 15+ ran off a vertical frame («ек» left of a word). Kept within what fits.
	params.fontSize = Math.min(12, Math.max(1.5, Number(args.fontSize) || 5));
	if (args.color) params.color = String(args.color);
	if (args.font) params.fontFamily = String(args.font);
	if (args.bold) params.fontWeight = "bold";
	const canvas = ed.project.getActive().settings.canvasSize;
	if (args.position === "top") params["transform.positionY"] = -canvas.height * 0.32;
	if (args.position === "bottom") params["transform.positionY"] = canvas.height * 0.32;
	const element = buildTextElement({
		raw: {
			name: String(params.content).slice(0, 30),
			duration: mediaTimeFromSeconds({ seconds: Math.max(0.2, Number(args.duration) || 3) }),
			params,
		},
		startTime: args.start === undefined ? ed.playback.getCurrentTime() : at(args.start),
	});
	ed.timeline.insertElement({ element, placement: { mode: "auto", trackType: "text" } });
	const added = addedSince(before)[0];
	return added ? describe(added.track, added.element) : "Added.";
}

// ───────────────────────── effects, transitions, color ─────────────────────────

function listEffects() {
	return effectsRegistry.getAll().map((d) => ({
		type: d.type,
		name: d.name,
		...(d.category ? { category: d.category } : {}),
		params: d.params.map((p) => `${p.key}${"min" in p && p.min !== undefined ? ` ${p.min}..${(p as { max?: number }).max ?? ""}` : ""}`).join(", "),
	}));
}

function addEffect(args: Args) {
	const found = find(args.id);
	const type = String(args.type ?? "");
	if (!effectsRegistry.has(type)) fail(`Unknown effect "${type}". Call list_effects.`);
	if (!("effects" in found.element) && found.element.type === "audio") fail("Effects are for pictures (video, image, text, graphics).");
	const effectId = editor().timeline.addClipEffect({ trackId: found.track.id, elementId: found.element.id, effectType: type });
	if (args.params && effectId) {
		editor().timeline.updateClipEffectParams({
			trackId: found.track.id,
			elementId: found.element.id,
			effectId,
			params: args.params as Record<string, ParamValue>,
		});
	}
	return `Added ${effectsRegistry.get(type).name} to ${short(found.element.id)}.`;
}

function setEffect(args: Args) {
	const found = find(args.id);
	const effects = ((found.element as { effects?: Array<{ id: string; type: string }> }).effects ?? []);
	const key = String(args.effect ?? "");
	const effect = effects.find((f) => f.id.startsWith(key) || f.type === key) ?? fail(`No effect "${key}" on this element.`);
	if (args.remove) {
		editor().timeline.removeClipEffect({ trackId: found.track.id, elementId: found.element.id, effectId: effect.id });
		return "Removed.";
	}
	editor().timeline.updateClipEffectParams({
		trackId: found.track.id,
		elementId: found.element.id,
		effectId: effect.id,
		params: (args.params ?? {}) as Record<string, ParamValue>,
	});
	return "Updated.";
}

function addTransition(args: Args) {
	const type = String(args.type ?? "");
	const def = ALL_TRANSITIONS.find((d) => d.type === type || d.name.toLowerCase() === type.toLowerCase()) ?? fail(`Unknown transition "${type}". Call list_transitions.`);
	const time = args.at === undefined ? editor().playback.getCurrentTime() : at(args.at);
	const cut = findNearestCut(time) ?? fail("There is no cut: put two video clips back to back on one track first.");
	if (!applyTransition({ cut, type: def.type })) fail("Couldn't add the transition there.");
	return `${def.name} at ${sec(cut.time)} s.`;
}

// ───────────────────────── media from outside ─────────────────────────

async function youtube(args: Args, signal: AbortSignal) {
	const query = String(args.query ?? args.url ?? "").trim();
	if (!query) fail("Give a YouTube link or a search query.");
	const isLink = /^https?:\/\//i.test(query) || /youtu\.?be/i.test(query);
	if (!isLink) {
		const hits = await studioApi.youtubeSearch(query, signal);
		if (!args.download) return { results: hits.map((h) => ({ url: h.url, title: h.title, channel: h.channel, duration: h.duration })) };
		if (!hits.length) fail("Nothing found on YouTube.");
		return youtube({ ...args, query: hits[0].url, title: hits[0].title }, signal);
	}
	const pid = projectId();
	const info = await studioApi.youtubeInfo(query, signal);
	const length = Number((info as { duration?: number }).duration) || 0;
	const start = Math.max(0, Number(args.from) || 0);
	const end = args.to !== undefined ? Number(args.to) : length;
	const full = args.from === undefined && args.to === undefined;
	const before = new Set(editor().media.getAssets().map((a) => a.id));
	const ok = await downloadFragment(
		editor(),
		pid,
		{ url: query, start, end: end || start + 60, title: String(args.title ?? (info as { title?: string }).title ?? "YouTube"), full },
		{ dialogOpen: () => false },
	);
	if (!ok) fail(fragmentError() || "The video didn't download.");
	const asset = editor().media.getAssets().find((a) => !before.has(a.id));
	if (!asset) return "Downloaded into Media.";
	return { media: short(asset.id), name: asset.name, duration: asset.duration, note: "In Media. Use add_media to put it on the timeline." };
}

async function webImage(args: Args, signal: AbortSignal) {
	const q = String(args.query ?? "").trim() || fail("Give what to search for.");
	const res = await fetch(`/api/images/search?q=${encodeURIComponent(q)}&page=1`, { signal });
	const data = (await res.json()) as { items?: Array<{ title: string; author: string; license: string; sourceUrl: string; fullUrl: string; thumbUrl: string }>; error?: string };
	const image = data.items?.[Math.min(Number(args.pick) || 0, (data.items?.length ?? 1) - 1)] ?? fail(data.error || "No pictures found.");
	let file = await fetch(`/api/images/file?u=${encodeURIComponent(image.fullUrl)}`, { signal });
	if (!file.ok) file = await fetch(`/api/images/file?u=${encodeURIComponent(image.thumbUrl)}`, { signal });
	if (!file.ok) fail("The picture didn't download.");
	const blob = await file.blob();
	const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
	const [processed] = await processMediaAssets({ files: [new File([blob], `${image.title.slice(0, 60).replace(/[/\\:]/g, " ")}.${ext}`, { type: blob.type })] });
	if (!processed) fail("The editor couldn't read this picture.");
	const asset = await editor().media.addMediaAsset({
		projectId: projectId(),
		asset: { ...processed!, origin: "source", attribution: { title: image.title, author: image.author, license: image.license, sourceUrl: image.sourceUrl } },
	});
	if (!asset) fail("Not enough disk space.");
	return { media: short(asset!.id), name: asset!.name, note: "In Media. Use add_media to place it." };
}

/** Animated graphics of the built-in library (Stickers tab): callouts, titles, lower thirds, arrows, social, emoji… */
async function findGraphic(args: Args) {
	const lib = useGraphicsLibrary.getState();
	await lib.load();
	const { items, imported, status } = useGraphicsLibrary.getState();
	const all = [...items, ...imported];
	if (!all.length) return status === "missing" ? `No graphics library on ${THIS_COMPUTER}.` : "The graphics library didn't load.";
	const words = String(args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
	const cat = String(args.category ?? "").toLowerCase();
	const hits = all.filter((g) => (!cat || g.category.toLowerCase().includes(cat)) && words.every((w) => `${g.name} ${g.category}`.toLowerCase().includes(w)));
	const categories = [...new Set(all.map((g) => g.category))];
	if (!hits.length) return `Nothing matches. Categories: ${categories.join(", ")}. Try one English word or a category.`;
	return { graphics: hits.slice(0, 25).map((g) => ({ id: g.id, name: g.name, category: g.category, seconds: Math.round(g.duration * 10) / 10, editableText: g.texts > 0 })), categories };
}

async function addGraphic(args: Args) {
	const id = String(args.graphic ?? "");
	await useGraphicsLibrary.getState().load();
	const { items, imported } = useGraphicsLibrary.getState();
	const item = [...items, ...imported].find((g) => g.id === id || g.name.toLowerCase() === id.toLowerCase()) ?? fail("Unknown graphic: use an id from find_graphic.");
	const before = snapshotIds();
	const placed = await insertGraphic(editor(), item!, args.start === undefined ? undefined : Number(args.start));
	const added = addedSince(before)[0];
	return { added: added ? short(added.element.id) : null, at: placed.start, seconds: placed.duration, note: "Move or resize it with set_element (transform.positionX/Y, transform.scaleX/Y)." };
}

/** A styled title from the Text tab's presets with the given words. */
async function addTextStyle(args: Args) {
	const preset = TEXT_PRESETS.find((p) => p.id === args.style) ?? fail(`Unknown style. Styles: ${TEXT_PRESETS.map((p) => p.id).join(", ")}.`);
	const ed = editor();
	const before = snapshotIds();
	const { element } = await buildPresetElement({ editor: ed, preset: preset!, content: args.text ? String(args.text).slice(0, 400) : undefined, at: args.start === undefined ? undefined : Number(args.start) });
	if (args.duration) (element as { duration: number }).duration = mediaTimeFromSeconds({ seconds: Math.max(0.3, Number(args.duration)) }) as unknown as number;
	ed.timeline.insertElement({ element, placement: { mode: "auto", trackType: "text" } });
	const added = addedSince(before)[0];
	return added ? describe(added.track, added.element) : "Added.";
}

/** The user's own media files on this Mac (Movies, Downloads, Desktop, Pictures, Music, Documents). */
async function localFiles(args: Args, signal: AbortSignal) {
	const res = await fetch("/api/studio/local-files/search", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio": "1" }, body: JSON.stringify({ query: String(args.query ?? ""), kind: args.kind }), signal });
	const data = (await res.json()) as { files?: Array<{ path: string; name: string; folder: string; kind: string; mb: number; modified: string }>; error?: string };
	if (!res.ok) fail(data.error || "Couldn't look through the folders.");
	if (!data.files?.length) return "No media files with that name in Movies, Downloads, Desktop, Pictures, Music or Documents.";
	return { files: data.files, note: "import_file with a path puts it into Media." };
}

async function importFile(args: Args, signal: AbortSignal) {
	const p = String(args.path ?? "") || fail("Give the path from local_files.");
	const name = p.split("/").pop() || "file";
	// taken where it is (the Mac app hands the very file over: no copy); else read through the server, as before
	let file = await userFileAt(p, signal);
	if (!file) {
		const res = await fetch(`/api/studio/local-file?path=${encodeURIComponent(p)}`, { headers: { "X-Studio": "1" }, signal });
		if (!res.ok) fail(((await res.json().catch(() => ({}))) as { error?: string }).error || "Couldn't read that file.");
		const blob = await res.blob();
		file = new File([blob], name, { type: blob.type || "" });
	}
	const [processed] = await processMediaAssets({ files: [file] });
	if (!processed) fail("The editor couldn't read this file.");
	const asset = await editor().media.addMediaAsset({ projectId: projectId(), asset: { ...processed!, origin: "source" } });
	if (!asset) fail("Not enough disk space.");
	return { media: short(asset!.id), name: asset!.name, kind: asset!.type, seconds: asset!.duration ? Math.round(asset!.duration * 10) / 10 : undefined, note: "In Media. Use add_media to place it." };
}

/** Facts from the web (Wikipedia) for titles, captions and explainers — never invent facts. */
async function webSearch(args: Args, signal: AbortSignal) {
	const res = await fetch("/api/studio/web/search", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio": "1" }, body: JSON.stringify({ query: String(args.query ?? ""), lang: args.lang }), signal });
	const data = (await res.json()) as { results?: Array<{ title: string; summary: string; url: string }>; error?: string };
	if (!res.ok) fail(data.error || "The web search didn't work.");
	return data.results?.length ? { results: data.results } : "Nothing found.";
}

/** fal.ai (the user's own key): billed video / image generations, put on the timeline when done. */
async function pointReady() {
	const st = await usePoint.getState().refresh();
	if (!st.connected) fail("No AI key is set (fal.ai, kie.ai or ArgoLink): tell the user to add one in Gaziyav → Settings → AI, then ask again.");
	return st;
}

async function pointList(args: Args) {
	await pointReady();
	const kind = args.kind === "image" ? "image" : "video";
	const list = await pointModels(kind);
	return list.map((m) => ({ id: m.id, title: m.title, durations: m.limits?.supported_durations_seconds, aspects: m.limits?.supported_aspect_ratios, qualities: m.limits?.supported_qualities, usd: m.usd, unit: kind === "video" ? "per second" : "per picture" }));
}

/** The last frame of a generated clip as a picture in Media (for the next shot's start frame). */
const framePictures = new Map<string, string>();

/** A video's last frame (or the frame at `at` seconds of its file) as a picture in Media, made once per frame. */
async function lastFrame(asset: MediaAsset, at?: number): Promise<MediaAsset | null> {
	if (asset.type !== "video" || !asset.file) return null;
	const key = `${asset.id}@${at === undefined ? "end" : at.toFixed(2)}`;
	const made = visibleMedia().find((a) => a.id === framePictures.get(key));
	if (made) return made;
	const url = URL.createObjectURL(asset.file);
	try {
		const video = document.createElement("video");
		video.muted = true;
		video.preload = "auto";
		video.src = url;
		await new Promise<void>((ok, bad) => {
			video.onloadedmetadata = () => ok();
			video.onerror = () => bad(new Error("no video"));
		});
		video.currentTime = at === undefined ? Math.max(0, video.duration - 0.05) : Math.min(Math.max(0, at), Math.max(0, video.duration - 0.05));
		await new Promise<void>((ok) => {
			video.onseeked = () => ok();
		});
		const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
		canvas.getContext("2d")?.drawImage(video, 0, 0);
		const blob = await canvas.convertToBlob({ type: "image/png" });
		const base = asset.name.replace(/\.[a-z0-9]+$/i, "");
		const [processed] = await processMediaAssets({ files: [new File([blob], `${base} · ${at === undefined ? "last frame" : `frame ${at.toFixed(2)} s`}.png`, { type: "image/png" })] });
		if (!processed) return null;
		const picture = (await editor().media.addMediaAsset({ projectId: projectId(), asset: { ...processed, origin: "result" } })) ?? null;
		if (picture) framePictures.set(key, picture.id);
		return picture;
	} finally {
		URL.revokeObjectURL(url);
	}
}

/**
 * "<clip id>@last": the last frame of a timeline clip as it plays (its trim and speed), or of a Media video, as a picture
 * in Media — the start frame of the next shot, so the same scene goes on. A picture id is its own last frame.
 */
async function lastOf(key: string): Promise<MediaAsset> {
	const k = key.trim();
	const clip = tracks()
		.flatMap((t) => t.elements as TimelineElement[])
		.find((e) => e.type === "video" && e.id.startsWith(k));
	const asset = clip && "mediaId" in clip ? findMedia(clip.mediaId) : findMedia(k);
	if (asset.type === "image") return asset;
	if (asset.type !== "video") fail(`"${asset.name}" is a sound: @last takes a video clip (a timeline clip or a Media video).`);
	let at: number | undefined;
	if (clip?.type === "video") {
		const end = (clip.trimStart + clip.duration * (clip.retime?.rate ?? 1)) / TICKS_PER_SECOND;
		if (!asset.duration || end < asset.duration - 0.1) at = Math.max(0, end - 0.05);
	}
	const picture = await lastFrame(asset, at).catch(() => null);
	return picture ?? fail(`Couldn't read the last frame of "${asset.name}" here (its format doesn't play in the window). Give a Media picture as from instead.`);
}

/** A sound for a generation: a timeline clip's trimmed piece (only that goes, K5/B11), or a Media sound (soundFrom/soundTo: its piece). */
function soundOf(args: Args): { asset: MediaAsset; trim?: { from: number; length: number }; seconds: number; label: string; at?: number } {
	const key = String(args.sound ?? "").trim();
	const onTimeline = key.length >= 4 ? tracks().flatMap((t) => t.elements as TimelineElement[]).find((e) => e.id.startsWith(key) && (e.type === "audio" || e.type === "video")) : undefined;
	if (onTimeline && "mediaId" in onTimeline && (onTimeline.type === "audio" || onTimeline.type === "video")) {
		const asset = findMedia(onTimeline.mediaId);
		const rate = onTimeline.retime?.rate ?? 1;
		const trim = { from: onTimeline.trimStart / TICKS_PER_SECOND, length: (onTimeline.duration * rate) / TICKS_PER_SECOND };
		return { asset, trim, seconds: trim.length, at: onTimeline.startTime / TICKS_PER_SECOND, label: `the piece of timeline clip ${short(onTimeline.id)} (${trim.from.toFixed(2)}–${(trim.from + trim.length).toFixed(2)} s of «${asset.name}»)` };
	}
	const asset = findMedia(key);
	if (asset.type === "image") fail(`"${asset.name}" is a picture: sound takes a Media sound (or a video with sound) or a timeline audio clip id.`);
	if (asset.type === "video" && asset.hasAudio === false) fail(`"${asset.name}" has no sound: give a Media sound or a timeline audio clip id.`);
	const length = Number(asset.duration) || 0;
	const a = args.soundFrom === undefined ? undefined : Number(args.soundFrom);
	const b = args.soundTo === undefined ? undefined : Number(args.soundTo);
	if (a === undefined && b === undefined) return { asset, seconds: length, label: `«${asset.name}» (${length.toFixed(1)} s)` };
	const from = Math.max(0, Number.isFinite(a) ? (a as number) : 0);
	const to = Math.min(length || Number.POSITIVE_INFINITY, Number.isFinite(b) ? (b as number) : length);
	if (!(to - from >= 0.3)) fail(`soundFrom/soundTo: seconds of «${asset.name}» (0–${length.toFixed(1)} s), at least 0.3 s apart.`);
	return { asset, trim: { from, length: to - from }, seconds: to - from, label: `${from.toFixed(2)}–${to.toFixed(2)} s of «${asset.name}»` };
}

/** A generation at exactly `cost` (the server refuses a dearer one), without the app's own price question: Claude's step. */
async function startLocked(input: PointInput, cost: number, again = false) {
	// `once`: the same request again (a call re-sent after a timeout, another start or place) is this job — joined while
	// it runs, returned when done (30 min), nothing charged twice (C2); `again`: a new take.
	const res = await fetch("/api/cloud/generate", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio": "1" }, body: JSON.stringify({ ...input, allowed: cost, once: true, ...(again ? { again: true } : {}) }) });
	const data = (await res.json().catch(() => ({}))) as { jobId?: string; cost?: number; error?: string; same?: { state: "running" | "succeeded"; at: number } };
	if (!res.ok || !data.jobId) fail(forClaude(data.error || "The generator didn't answer. Check the internet connection."));
	const job = { id: data.jobId!, kind: input.kind, model: input.model, prompt: input.prompt, cost: data.cost ?? cost, state: "queued" as const, progress: 0, error: null, files: [], at: Date.now(), input, ...(input.duration_seconds ? { duration: input.duration_seconds } : {}), quiet: true };
	usePoint.setState({ jobs: [job, ...usePoint.getState().jobs.filter((j) => j.id !== job.id)].slice(0, 40) });
	return { job, same: data.same };
}

/** «3 min ago», «40 s ago». */
const ago = (at: number) => {
	const s = Math.max(0, Math.round((Date.now() - at) / 1000));
	return s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
};

async function pointGenerate(args: Args, signal: AbortSignal) {
	await pointReady();
	if (args.kind === "audio") fail("Music and sound generation isn't part of this app: use find_sound for library music, or generate_voice for speech.");
	const kind = args.kind === "image" ? "image" : "video";
	const prompt = String(args.prompt ?? "").trim();
	// A video's mode (start frame, first+last frame, references, motion, restyle, avatar, extend): its own models.
	const mode = kind === "video" && typeof args.mode === "string" && args.mode !== "text" ? String(args.mode) : "";
	// Everything the mode needs, and what is missing, in one answer (A14) — before anything is priced or uploaded.
	const missing = missingInputs(kind, mode, args);
	if (missing) fail(missing);
	// The mode's models and the model a named id means for it: one resolver with price_plan (B4/A20/C9) — an id of another
	// mode becomes its family's model of this mode (said in the answer); any other unknown id is refused before paying.
	const listMode = kind === "video" ? mode || (args.from ? "image" : "text") : undefined;
	const named = typeof args.model === "string" && args.model && args.model !== "cheapest" ? args.model : undefined;
	const { list: all, resolved } = await cloudModelsFor(kind, listMode, named);
	const models = all as unknown as Awaited<ReturnType<typeof pointModels>>;
	if (!models.length) fail(mode ? `No model does "${mode}" with the keys there are (price_plan {kind:"video", mode:"${mode}"} lists them).` : "No models for that.");
	if (named && (!resolved || "error" in resolved)) fail(`Not run: ${resolved && "error" in resolved ? resolved.error : `no ${kind} model "${named}"`}. Nothing was spent.`);
	const swapNote = resolved && "id" in resolved ? resolved.note : undefined;
	// Not on a provider that can't pay now (no key, refused for an empty balance in the last 15 min) when Claude didn't name one.
	const off = underBudget() ? await blockedApis().catch(() => new Set<AiApi>()) : new Set<AiApi>();
	const open = models.filter((m) => !off.has((m.api ?? "fal") as AiApi));
	const list = named || !open.length ? models : open;
	/** The same step on another provider (or another model), for a refusal or a time-out: «"<id>" (Title, kie.ai)». */
	const otherThan = (m: { id: string; api?: string }) => {
		const cheap = (a: (typeof models)[number], b: (typeof models)[number]) => (a.usd ?? 0) - (b.usd ?? 0);
		const rest = models.filter((x) => x.id !== m.id && (x.usd ?? 0) > 0 && !off.has((x.api ?? "fal") as AiApi)).sort(cheap);
		const pick = rest.find((x) => (x.api ?? "fal") !== (m.api ?? "fal")) ?? rest[0];
		return pick ? `"${pick.id}" (${pick.title}, ${API_LABEL[(pick.api ?? "fal") as AiApi]})` : undefined;
	};
	const canvas = editor().project.getActive().settings.canvasSize;
	const want = String(args.aspect ?? (canvas.height >= canvas.width ? "9:16" : "16:9"));
	const duration = Number(args.duration) || 5;
	// A price is only a price: nothing is uploaded for it (B5: quote:true uploaded the inputs to fal first, and died there).
	const quote = !!args.quote;
	let planned = 0;
	const idsOf = (v: unknown) => (Array.isArray(v) ? v.map(String) : String(v ?? "").split(/[,\s]+/)).filter(Boolean);
	// References from Media: a picture starts the video (or guides the image); a cast member's pictures by name.
	const refs: Partial<PointInput> = {};
	const pictures = async (v: unknown) => {
		const out: string[] = [];
		for (const id of idsOf(v)) {
			// "<clip id>@last": that clip's last frame as a picture (the same scene goes on), made when asked for (once).
			const asset = /@last$/i.test(id) ? await lastOf(id.replace(/@last$/i, "")) : findMedia(id);
			if (asset.type !== "image") fail(`Only a picture can guide a generation; "${asset.name}" is a ${asset.type} (its last frame: "${id}@last").`);
			// a quote counts the pictures; only a run sends them (to the model's own API)
			out.push(quote ? `planned-${planned++}` : await pointReference(asset.file, "image"));
		}
		return out;
	};
	const castPictures = (await castOf(args.cast)).flatMap((c) => c.images);
	const from = await pictures(args.from);
	const extra = await pictures([...idsOf(args.refs), ...castPictures]);
	let inputSeconds: number | undefined;
	let soundLabel = "";
	let soundSync: { at?: number; sound: string; soundFrom: number } | undefined;
	if (kind === "image" || mode === "") {
		if (from.length || extra.length) refs.image_asset_ids = [...from, ...extra];
	} else {
		if (from.length) refs.image_asset_ids = from;
		if (extra.length) refs.reference_asset_ids = extra;
		if (args.end) refs.end_image_asset_ids = await pictures(args.end);
		// A clip (motion, restyle, extend): the Media file, or a timeline clip's piece as it plays.
		if (args.clip) {
			const key = String(args.clip);
			const onTimeline = tracks().flatMap((t) => t.elements as TimelineElement[]).find((e) => e.id.startsWith(key) && (e.type === "video" || e.type === "audio"));
			const asset = onTimeline && "mediaId" in onTimeline ? findMedia(onTimeline.mediaId) : findMedia(key);
			const trim = onTimeline && (onTimeline.type === "video" || onTimeline.type === "audio") ? { from: onTimeline.trimStart / TICKS_PER_SECOND, length: (onTimeline.duration * (onTimeline.retime?.rate ?? 1)) / TICKS_PER_SECOND } : undefined;
			if (quote) {
				refs.video_asset_ids = [`planned-${planned++}`];
				refs.reference_video_duration_seconds = Math.round((trim?.length ?? (Number(asset.duration) || 5)) * 100) / 100;
			} else {
				const sent = await pointUpload(asset.file, "video", trim);
				refs.video_asset_ids = [sent.id];
				if (sent.seconds) refs.reference_video_duration_seconds = Math.ceil(sent.seconds);
			}
			inputSeconds = refs.reference_video_duration_seconds;
		}
		// A sound (avatar): a Media sound, its piece (soundFrom/soundTo), or a timeline audio clip's trimmed piece — only the
		// piece is sent, billed and quoted (K5/B11/C14: a 4 s shot was quoted $7.47 for the whole 132 s stem).
		if (args.sound) {
			const s = soundOf(args);
			soundLabel = s.label;
			soundSync = { at: s.at, sound: s.asset.id, soundFrom: s.trim?.from ?? 0 };
			if (quote) {
				refs.audio_asset_ids = [`planned-${planned++}`];
				refs.reference_audio_duration_seconds = Math.round(s.seconds * 100) / 100;
			} else {
				const sent = await pointUpload(s.asset.file, "audio", s.trim);
				refs.audio_asset_ids = [sent.id];
				refs.reference_audio_duration_seconds = sent.seconds ?? Math.round(s.seconds * 100) / 100;
			}
			inputSeconds = refs.reference_audio_duration_seconds;
		}
		refs.mode = mode as PointInput["mode"];
	}
	if (args.seed !== undefined && Number.isFinite(Number(args.seed))) refs.seed = Math.round(Number(args.seed));
	if (typeof args.negative === "string" && args.negative.trim()) refs.negative_prompt = args.negative.trim();
	if (typeof args.audio === "boolean") refs.generate_audio = args.audio;
	// One model's request: its nearest length, the asked shape and quality when it has them, the inputs above.
	const inputFor = (m: (typeof list)[number]): PointInput => {
		const aspects = m.limits?.supported_aspect_ratios ?? [];
		const durations = m.limits?.supported_durations_seconds ?? [];
		const qualities = m.limits?.supported_qualities ?? [];
		return {
			kind,
			prompt,
			model: m.id,
			...(aspects.includes(want) ? { aspect_ratio: want } : aspects[0] ? { aspect_ratio: aspects[0] } : {}),
			...(kind === "video" ? { duration_seconds: durations.length ? durations.reduce((a, b) => (Math.abs(b - duration) < Math.abs(a - duration) ? b : a)) : duration } : {}),
			...(args.quality && qualities.includes(String(args.quality)) ? { quality: String(args.quality) } : qualities[0] ? { quality: qualities[0] } : {}),
			...refs,
		};
	};
	// model:"cheapest" = the cheapest model that takes these inputs, priced as price_plan prices it; else the one named, else the default.
	const fit =
		args.model === "cheapest"
			? await cheapestOf(kind, list, { duration: kind === "video" ? duration : undefined, quality: args.quality ? String(args.quality) : undefined, aspect: want }, inputFor).catch((error: Error) => fail(`Not run: ${error.message}. Nothing was spent.`))
			: null;
	const chosen = named ? models.find((m) => m.id === (resolved as { id: string }).id) : undefined;
	if (named && !chosen) fail(`Not run: ${named} isn't one of the ${listMode ?? "picture"} models with a key here (price_plan {kind:"${kind}"${listMode ? `, mode:"${listMode}"` : ""}} lists them). Nothing was spent.`);
	const model = fit?.model ?? chosen ?? list.find((m) => m.default) ?? list[0] ?? fail("No models for that.");
	const input: PointInput = fit ? fit.input : inputFor(model);
	const pickDuration = input.duration_seconds ?? duration;
	// Claude (the connector): priced first; the price is locked. A provider that can't pay stops it (money.ts gate).
	const api = (model.api ?? "fal") as AiApi;
	const billed = inputSeconds !== undefined ? Math.max(1, Math.ceil(inputSeconds - 0.1)) : undefined;
	const what = kind === "image" ? `a picture with ${model.title}` : inputSeconds !== undefined ? `a ${inputSeconds.toFixed(1)} s ${mode === "avatar" ? "lipsync video" : "video"} (${billed} s billed) with ${model.title}` : `a ${pickDuration} s video with ${model.title}`;
	const passed = !named && open.length && open.length < models.length ? `${[...off].map((a) => API_LABEL[a]).join(", ")} can't pay now: picked from the other providers` : "";
	const picked = [fit ? `the cheapest of ${fit.of} models that take these inputs${fit.exact ? "" : " (none makes it exactly as asked: the nearest)"}` : "", passed].filter(Boolean).join(" · ");
	let paid = "";
	let job: Awaited<ReturnType<ReturnType<typeof usePoint.getState>["start"]>>;
	let same: { state: "running" | "succeeded"; at: number } | undefined;
	if (quote || underBudget()) {
		const cost = fit?.cost ?? (await estimatePoint(input).catch((error: Error) => fail(`Not run: ${forClaude(error.message)} Nothing was spent.`)));
		if (quote) return `${what} [${model.id}] on ${API_LABEL[api]}: ${usd(cost)} (nothing spent)${soundLabel ? ` · sound: ${soundLabel}` : ""}${swapNote ? ` · ${swapNote}` : ""}${picked ? ` · ${picked}` : ""} · ${budgetLine(await readBudget())}.`;
		await gate(what, cost, api, otherThan(model), args.again === true);
		({ job, same } = await startLocked(input, cost, args.again === true));
		paid = what;
	} else job = await usePoint.getState().start(input, { quiet: true });
	// Followed every second (C2d: every 4 s made answers miss Claude's 45 s by a few seconds), as long as the job may run.
	const limit = (kind === "image" ? 240 : mode === "avatar" || mode === "motion" ? 1200 : 900) + 120;
	const t0 = Date.now();
	for (;;) {
		if (signal.aborted) {
			// Stop (the user in Claude, or status {cancel}): a job the provider hasn't started is cancelled — nothing charged;
			// a started one is paid anyway and lands in Media (the same call again hands it over, never paid twice).
			const now = usePoint.getState().jobs.find((x) => x.id === job.id);
			const who = API_LABEL[api];
			if (now?.state === "succeeded") return `${who} had finished it before the stop (≈ ${usd(job.cost)} charged): it is in Media → Generate; the same call again places it, never paid twice.`;
			if (now?.state === "failed") return `It had failed before the stop: ${forClaude(now.error ?? "the generation failed")}`;
			if (now?.state !== "running") {
				await fetch(`/api/cloud/cancel/${job.id}`, { method: "POST", headers: { "X-Studio": "1" } }).catch(() => {});
				return api === "fal" ? `Stopped before ${who} started it: nothing charged.` : `Stopped before ${who} started it: nothing charged (${who} can't cancel a waiting task: if it starts later its log shows it, and the same call again picks that one up, never paid twice).`;
			}
			return `${who} had started it (≈ ${usd(job.cost)} charged); it lands in Media → Generate when ready — the same call again returns it, never paid twice.`;
		}
		await usePoint.getState().poll();
		const j = usePoint.getState().jobs.find((x) => x.id === job.id);
		if (j?.state === "succeeded" && j.files.length) {
			const asset = await resultToMedia(j);
			const asked = args.start === undefined ? editor().playback.getCurrentTime() / TICKS_PER_SECOND : Math.max(0, Number(args.start) || 0);
			// review checks a performance shot sits where its own sound plays (production/review.ts): the time it belongs at
			if (soundSync) await rememberSync(asset.id, { at: soundSync.at ?? asked, sound: soundSync.sound, soundFrom: soundSync.soundFrom }).catch(() => {});
			// Where it really landed (B10/C12): under the titles; the same result already placed there is not placed twice.
			let placed: ReturnType<typeof placeGenerated> = null;
			if (args.place !== false) {
				const there = tracks().flatMap((t) => (t.elements as TimelineElement[]).map((e) => ({ t, e }))).find(({ e }) => "mediaId" in e && e.mediaId === asset.id && Math.abs(e.startTime / TICKS_PER_SECOND - asked) < 0.05);
				placed = there
					? { elementId: there.e.id, trackId: there.t.id, start: there.e.startTime / TICKS_PER_SECOND, end: (there.e.startTime + there.e.duration) / TICKS_PER_SECOND, role: there.t.id === editor().scenes.getActiveScene().tracks.main.id ? "main video" : "overlay", newTrack: false }
					: placeGenerated(editor(), asset, asked, { track: typeof args.track === "string" ? args.track : undefined });
			}
			// What the provider really charged (kie.ai reports its credits), else the locked price.
			const real = paid ? ((await fetch(`/api/cloud/job/${job.id}`, { headers: { "X-Studio": "1" } }).then((r) => r.json()).catch(() => null)) as { cost?: number } | null)?.cost ?? job.cost : job.cost;
			const r2 = (n: number) => Math.round(n * 100) / 100;
			const spent = paid
				? same?.state === "succeeded"
					? // (counted for this video once, if the call that made it never got to say so)
						`nothing new charged: made ${ago(same.at)} by the same request (again:true makes a new take) · ${(await charged(paid, real, api, job.id), budgetLine(await readBudget()))}`
					: `${await charged(paid, real, api, job.id)}${same ? " (joined the same request already running: charged once)" : ""}`
				: undefined;
			return {
				media: short(asset.id),
				name: asset.name,
				model: `${model.title} [${model.id}] on ${API_LABEL[api]}`,
				...(swapNote ? { note: swapNote } : {}),
				...(picked ? { picked } : {}),
				...(soundLabel ? { sound: soundLabel } : {}),
				costUsd: real,
				...(args.place === false ? { placed: "only in Media (place:false)" } : placed ? { placed: { clip: short(placed.elementId), start: r2(placed.start), end: r2(placed.end), track: `${short(placed.trackId)} (${placed.role}${placed.newTrack ? ", new" : ""})` }, ...(Math.abs(placed.start - asked) > 0.05 ? { moved: `asked ${r2(asked)} s, the timeline put it at ${r2(placed.start)} s` } : {}) } : { placed: "not placed: the timeline refused it (it is in Media)" }),
				// the next shot from this one's last frame: made only when asked (C2d, A11: a «· last frame» picture per video crowded Media)
				...(kind === "video" ? { next: `from:"${short(asset.id)}@last" starts the next shot from its last frame` } : {}),
				...(spent ? { spent } : {}),
			};
		}
		if (j?.state === "failed") {
			const error = j.error ?? "The generation failed.";
			fail(lateLine(error, kind === "image" ? "picture" : "video", otherThan(model)) ?? forClaude(error, otherThan(model)));
		}
		if (Date.now() - t0 > limit * 1000) return `Still generating in Media → Generate (≈ $${job.cost.toFixed(3)}); the same call again returns it when ready, never paid twice.`;
		// (a Stop wakes it at once)
		await Promise.race([sleep(1000), new Promise((done) => signal.addEventListener("abort", done, { once: true }))]);
	}
}

let libraryCache: LibraryIndex | null = null;
async function findSound(args: Args, signal: AbortSignal) {
	if (!libraryCache) libraryCache = (await (await fetch("/api/library/index", { signal })).json()) as LibraryIndex;
	const kind = args.kind === "sfx" ? "sfx" : "music";
	if (!libraryCache.items.some((i) => i.kind === kind)) {
		return kind === "music" ? `There is no ready-made music on ${THIS_COMPUTER}. Skip it and tell the user (music isn't generated in this app).` : `The sound effects library on ${THIS_COMPUTER} is empty.`;
	}
	const words = String(args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
	const scored = libraryCache.items
		.filter((i) => i.kind === kind)
		.map((i) => {
			const hay = `${i.name} ${i.cat} ${i.tags.join(" ")}`.toLowerCase();
			return { i, score: words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0) };
		})
		.filter((x) => !words.length || x.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, 12);
	return scored.map(({ i }) => ({ id: i.id, name: i.name, category: i.cat, seconds: Math.round(i.dur) }));
}

async function addSound(args: Args, signal: AbortSignal) {
	if (!libraryCache) await findSound({ query: "" }, signal);
	const key = String(args.sound ?? "");
	const item = libraryCache?.items.find((i) => i.id === key) ?? fail(`No sound "${key}". Use find_sound first.`);
	const ed = editor();
	const before = snapshotIds();
	const element = buildLibraryClip({
		entry: { url: libraryFileUrl(item.id), name: item.name, dur: item.dur, kind: item.kind },
		startTime: args.start === undefined ? (item.kind === "music" ? (0 as ReturnType<typeof at>) : ed.playback.getCurrentTime()) : at(args.start),
		tracks: ed.scenes.getActiveScene().tracks,
	});
	ed.timeline.insertElement({ element, placement: { mode: "auto", trackType: "audio" } });
	const added = addedSince(before)[0];
	return added ? describe(added.track, added.element) : "Added.";
}

// ───────────────────────── AI on this Mac ─────────────────────────

async function captions(args: Args, signal: AbortSignal) {
	const ed = editor();
	// The recognizer reads the selected clip (the Captions tab's rule), and the agent's last step leaves its clip
	// selected: captions cover the whole edit unless `id` names one clip. The user's selection comes back after.
	const kept = ed.selection.getSelectedElements();
	const f = args.id ? find(args.id) : null;
	if (f) ed.selection.setSelectedElements({ elements: [{ trackId: f.track.id, elementId: f.element.id }] });
	else ed.selection.clearSelection();
	let chunks: Awaited<ReturnType<typeof generateLocalCaptions>>;
	try {
		chunks = await generateLocalCaptions({ editor: ed, language: String(args.language ?? "auto"), signal });
	} finally {
		ed.selection.setSelectedElements({ elements: kept });
	}
	if (!chunks) fail(`Speech recognition isn't available on ${THIS_COMPUTER}.`);
	const trackId = insertCaptionChunksAsTextTrack({ editor: ed, captions: chunks!, style: args.style ? (String(args.style) as CaptionStyleId) : undefined });
	if (!trackId) fail("No speech found for captions.");
	return `Added ${chunks!.length} captions on their own track.`;
}

/** A generator that isn't on this Mac (and isn't carried by the app) would open a multi-GB download mid-edit. */
async function generatorReady(kind: "voice"): Promise<string | null> {
	const id = kind;
	const state = await useOndeviceStore.getState().refresh();
	const model = state?.models.find((m) => m.id === id);
	if (!model || model.installed || model.bundled || model.job?.status === "running") return null;
	if (model.unsupported) return `The ${kind} generator can't run on ${THIS_COMPUTER}: ${model.unsupported}`;
	return `The ${kind} generator isn't on ${THIS_COMPUTER} yet (a one-time ${formatBytes(model.downloadBytes)} download, started from the AI tab). Skip it, finish the rest, and tell the user at the end.`;
}

/** The speech model a ready voice speaks through (the pick of Settings → AI, on an API that has a key) and its price for a text. */
function ttsPrice(chars: number): { model: FalModel; cost: number; api: AiApi } {
	const model = chosenModel("tts", falChoices(), falKeys());
	return { model, cost: price(model, Math.max(1, chars), unitPrice(model)), api: apiOf(model) };
}

async function generateThing(kind: "voice", args: Args) {
	const missing = await generatorReady(kind);
	if (missing) fail(missing);
	const ed = editor();
	// A voice is spoken by the provider's speech model, by characters: priced, held to the budget and counted in the
	// video's spend like every paid step (it was called «free, on this Mac»: nine lines of a news piece went to fal.ai
	// and none of it reached the spend Claude reports, exam 11.11).
	const text = String(args.text ?? "").trim();
	const tts = ttsPrice(text.length);
	const what = `a voice of ${text.length} characters`;
	const quoted = await paidStep(`${what} (${tts.model.title})`, tts.cost, tts.api, args.quote);
	if (quoted) return quoted;
	// Where it goes is settled now: several voices asked at once are made one after another, and the playhead at the
	// moment each one is ready says nothing (seven lines all landed at 0).
	const start = args.start !== undefined ? Number(args.start) : sec(ed.playback.getCurrentTime());
	// The same words in the same voice asked again within 30 minutes (a call re-sent after a timeout, a batch sent
	// twice) is the voice already made: no new job, nothing charged; again:true makes a new take.
	const key = `${projectId()}|${String(args.speaker ?? "")}|${String(args.style ?? "")}|${text}`;
	const known = voicesMade.get(key);
	const kept = known && Date.now() - known.at < 30 * 60_000 && args.again !== true ? ed.media.getAssets().find((a) => a.id === known.media) : undefined;
	if (kept) {
		const same: Record<string, unknown> = { media: kept.id, name: kept.name, ...(kept.duration ? { seconds: Math.round(kept.duration * 100) / 100 } : {}), spent: "nothing new charged: this voice was made a moment ago by the same request (again:true makes a new take)" };
		if (args.place === false) return { ...same, note: "In Media, not placed." };
		const tracks = ed.scenes.getActiveScene().tracks;
		const there = [...tracks.overlay, tracks.main, ...tracks.audio].flatMap((t) => (t.elements as TimelineElement[]).map((e) => ({ t: t as TimelineTrack, e }))).find((x) => (x.e as { mediaId?: string }).mediaId === kept.id && Math.abs(x.e.startTime / TICKS_PER_SECOND - start) < 0.05);
		return { ...same, placed: there ? describe(there.t, there.e) : addMedia({ media: kept.id, start }) };
	}
	const { quote: _quote, place: _place, start: _start, again: _again, ...body } = args;
	let made: MediaAsset | null = null;
	const ok = await generate(kind, body, { queue: true, toMedia: (a) => (made = a) });
	const asset = made as MediaAsset | null;
	if (!ok || !asset) fail(`The ${kind} wasn't made (see the message in the app). Nothing was charged.`);
	const voice = asset as MediaAsset;
	const out: Record<string, unknown> = { media: voice.id, name: voice.name, ...(voice.duration ? { seconds: Math.round(voice.duration * 100) / 100 } : {}), model: `${tts.model.title} on ${API_LABEL[tts.api]}`, costUsd: Math.round(tts.cost * 1e4) / 1e4 };
	if (underBudget()) out.spent = await charged(what, tts.cost, tts.api);
	voicesMade.set(key, { media: voice.id, at: Date.now() });
	if (args.place === false) return { ...out, note: "In Media, not placed." };
	return { ...out, placed: addMedia({ media: voice.id, start }) };
}

/** Voices made in this sitting: project | speaker | style | words → the Media item (asked again: returned, never paid twice). */
const voicesMade = new Map<string, { media: string; at: number }>();

const NEURAL: Record<string, { family: NeuralFamilyId; values: Record<string, ParamValue> }> = {
	remove_background: { family: "background", values: { mode: "remove" } },
	blur_background: { family: "background", values: { mode: "blur" } },
	color_background: { family: "background", values: { mode: "color" } },
	enhance: { family: "enhance", values: {} },
	denoise: { family: "denoise", values: {} },
	upscale_2x: { family: "upscale", values: { scale: 2 } },
	upscale_4x: { family: "upscale", values: { scale: 4 } },
	retouch: { family: "retouch", values: {} },
	deflicker: { family: "deflicker", values: {} },
	enhance_voice: { family: "voiceEnhance", values: {} },
	separate_voice: { family: "separate", values: {} },
	voice_changer: { family: "voiceChange", values: {} },
};
/** The sound tools: an audio clip of its own takes them too, not only a video's sound. */
const SOUND_FAMILIES = new Set<NeuralFamilyId>(["voiceEnhance", "separate", "voiceChange"]);

async function aiEffect(args: Args, signal: AbortSignal) {
	const pick = NEURAL[String(args.kind)] ?? fail(`Unknown AI effect. One of: ${Object.keys(NEURAL).join(", ")}`);
	const { track, element } = SOUND_FAMILIES.has(pick.family) ? find(args.id) : findVideo(args.id);
	const values = { ...pick.values, ...((args.params as Record<string, ParamValue>) ?? {}) };
	const r = await settle(() => {
		if (!applyToClip(track.id, element.id, pick.family, values)) fail("This clip's file isn't available.");
	}, signal);
	return r.jobs.join("; ") || "Done.";
}

/** Claude's paid step that runs in the studio pipeline: its price from the same tables, within the budget. */
async function paidStep(what: string, cost: number, api: AiApi, quote: unknown): Promise<string | null> {
	if (quote) return `${what} on ${API_LABEL[api]}: ≈ ${usd(cost)} (nothing spent) · ${budgetLine(await readBudget())}.`;
	if (underBudget()) await gate(what, cost, api);
	return null;
}

const clipSeconds = (element: TimelineElement) => element.duration / TICKS_PER_SECOND;
/** Seconds new words take when said: ~15 characters a second. */
const speechSeconds = (text: string) => Math.max(1, text.length / 15);

/** The AI models the user picked in Settings → AI (or the defaults of the APIs with a key). */
const falChoices = () => useFal.getState().status?.choices;
const falKeys = () => keysOf(useFal.getState().status);

function voiceCost(chars: number): number {
	const tts = falTts();
	return price(tts, chars, unitPrice(tts)) + price(chosenModel("clone", undefined));
}

function lipCost(seconds: number, model?: FalModel): { cost: number; api: AiApi } {
	const m = model ?? chosenModel("lipsync", falChoices(), falKeys());
	return { cost: price(m, seconds + LIPSYNC_TAIL_SECONDS, unitPrice(m)), api: apiOf(m) };
}

/**
 * The lipsync model of one call: the one it names (an id of price_plan {kind:"lipsync"}, or "cheapest": the cheapest
 * that takes this length), else the pick of this project's Lipsync window / Settings → AI. The price and the request
 * both follow it (a named model was ignored: LatentSync ran and charged $0.20 where price_plan had said $0.085, 11.11).
 */
function lipsyncModelFor(named: unknown, seconds: number, pid: string): FalModel {
	const amount = seconds + LIPSYNC_TAIL_SECONDS;
	const fits = (m: FalModel) => (m.maxSeconds === undefined || amount <= m.maxSeconds) && (m.minSeconds === undefined || amount >= m.minSeconds);
	const list = modelsFor("lipsync", falKeys());
	const cost = (m: FalModel) => price(m, amount, unitPrice(m));
	const name = typeof named === "string" ? named.trim() : "";
	if (!name) return falModel(studioLipsyncModel(pid).id) ?? chosenModel("lipsync", falChoices(), falKeys());
	const offer = () => list.map((m) => `${m.id} (${m.title}, ${usd(cost(m))} for this clip${fits(m) ? "" : ", not for this length"})`).join(" · ");
	if (name === "cheapest") return [...list].filter(fits).sort((x, y) => cost(x) - cost(y))[0] ?? fail(`No lipsync model takes ${seconds.toFixed(1)} s: ${offer()}. Nothing was spent.`);
	const low = name.toLowerCase();
	const hit = list.find((m) => m.id === name) ?? list.find((m) => m.id.toLowerCase() === low || m.title.toLowerCase() === low) ?? list.find((m) => m.id.toLowerCase().includes(low) || m.title.toLowerCase().includes(low));
	if (!hit) fail(`No lipsync model "${name}". With a key now: ${offer()} — or model:"cheapest". Nothing was spent.`);
	return hit as FalModel;
}

/**
 * The studio pipeline (lipsync, revoice, dub, face swap) works on ONE pinned clip with one draft per project: two of
 * its steps at once write over each other's clip and sound (a batch of two lipsyncs made both results from the second
 * clip and left the first as it was, both charged: exam 11.11). So they take turns.
 */
let studioTurn: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(run: () => Promise<T>): Promise<T> {
	const mine = studioTurn.catch(() => {}).then(run);
	studioTurn = mine.catch(() => {});
	return mine;
}

async function faceSwap(args: Args, signal: AbortSignal) {
	const { element } = findVideo(args.id);
	{
		const m = chosenModel("faceswap", falChoices(), falKeys());
		const quoted = await paidStep(`face swap of ${Math.round(clipSeconds(element))} s`, price(m, clipSeconds(element), unitPrice(m)), "fal", args.quote);
		if (quoted) return quoted;
	}
	let choice: Parameters<typeof faceSwapClip>[1];
	if (args.photo) {
		if (args.consent !== true) fail("A real person's photo needs their permission: ask the user to confirm it, then call again with consent: true.");
		choice = { mediaId: findMedia(args.photo).id, consent: true };
	} else {
		const face = FACES.find((f) => f.id === String(args.face ?? "").toLowerCase()) ?? fail(`face: one of ${FACES.map((f) => f.id).join(", ")}`);
		choice = { preset: face.id };
	}
	const r = await settle(() => faceSwapClip(element.id, choice), signal);
	if (!r.value) fail(r.jobs.join("; ") || "The face swap didn't finish.");
	if (underBudget()) {
		const m = chosenModel("faceswap", falChoices(), falKeys());
		return `Face swapped on the clip; ${await charged("face swap", price(m, clipSeconds(element), unitPrice(m)), "fal")}.`;
	}
	return "Face swapped on the clip.";
}

async function speed(args: Args, signal: AbortSignal) {
	const { track, element } = findVideo(args.id);
	const ed = editor();
	const { curve: _c, mode: _m, ...keep } = element.retime ?? { rate: 1, maintainPitch: true };
	const retime = { ...keep };
	if (args.rate !== undefined) Object.assign(retime, { rate: Math.min(100, Math.max(0.05, Number(args.rate) || 1)), mode: "constant" as const });
	if (args.keepPitch !== undefined) retime.maintainPitch = !!args.keepPitch;
	if (args.opticalFlow !== undefined) retime.smooth = !!args.opticalFlow;
	ed.timeline.updateElementRetime({ trackId: track.id, elementId: element.id, retime: retime as VideoElement["retime"] });
	if (args.opticalFlow) await settle(() => renderSmooth(element.id), signal);
	return `Speed ${retime.rate ?? 1}×${retime.smooth ? " with optical flow" : ""}.`;
}

async function freeze(args: Args) {
	const { track, element } = findVideo(args.id);
	if (args.at !== undefined) editor().playback.seek({ time: at(args.at) });
	if (!(await freezeFrame({ trackId: track.id, elementId: element.id }))) fail("Put the playhead over the clip (or give `at` inside it).");
	return "Freeze frame added (3 s).";
}

async function reverse(args: Args, signal: AbortSignal) {
	const { element } = findVideo(args.id);
	const r = await settle(() => toggleReverse(element.id), signal);
	return r.value ? (element.reversed ? "Reverse removed." : "Reversed.") : fail("Couldn't reverse this clip.");
}

async function track(args: Args, signal: AbortSignal) {
	const { element } = findVideo(args.id);
	const kind = (["face", "object", "subject"].includes(String(args.kind)) ? args.kind : "face") as TrackerKind;
	const fxKind = String(args.effect ?? "none") as keyof typeof DEFAULT_FX;
	const r = await settle(
		() => trackClip({ elementId: element.id, kind, fx: DEFAULT_FX[fxKind] ?? undefined, ...(Array.isArray(args.box) ? { rect: args.box as [number, number, number, number] } : {}) }),
		signal,
	);
	const tracker = r.value as { id: string } | null;
	if (!tracker) fail(r.jobs.join("; ") || `No ${kind} found to track.`);
	return { tracker: tracker!.id.slice(0, 6), note: "Use follow to pin a text/sticker to it." };
}

function follow(args: Args) {
	const follower = find(args.id);
	if (args.off) return detachFollower(editor(), follower.element.id) ? "Unpinned." : fail("It wasn't following anything.");
	const clip = findVideo(args.clip);
	const trackers = clip.element.trackers ?? [];
	const tracker = trackers.find((t) => !args.tracker || t.id.startsWith(String(args.tracker))) ?? fail("That clip has no tracker yet: call track first.");
	if (!attachFollower(editor(), follower.element.id, clip.element.id, tracker.id, { scale: !!args.scale })) fail("Couldn't pin it (is the playhead over the clip?).");
	return "Now follows the tracked object.";
}

async function reframe(args: Args, signal: AbortSignal) {
	const list = ids(args.ids).map(findVideo);
	const aspect = (ASPECTS.find((a) => a.id === args.aspect)?.id ?? "9:16") as AspectId;
	const targets = list.length ? list : tracks().flatMap((t) => (t.elements as TimelineElement[]).filter((e) => e.type === "video").map((element) => ({ track: t, element })));
	if (!targets.length) fail("No video clips to reframe.");
	await settle(() => reframeClips(targets.map((f) => f.element.id), aspect), signal);
	return `Reframed ${targets.length} clip(s) to ${aspect}; the subject stays in frame.`;
}

async function assist(kind: "auto_color" | "split_scenes" | "beat_markers" | "remove_pauses", args: Args, signal: AbortSignal) {
	const f = find(args.id);
	const ref = { trackId: f.track.id, elementId: f.element.id };
	const r = await settle(
		() =>
			kind === "auto_color" ? autoColor(ref) : kind === "split_scenes" ? splitScenes(ref) : kind === "beat_markers" ? markBeats(ref) : removePausesInClip(ref),
		signal,
	);
	// Remove pauses says what it did (or that there were none): the agent repeats that instead of guessing — and what
	// went with the cut (two examinees had to read the whole project again to learn that captions and titles moved and
	// the music did not).
	if (kind !== "remove_pauses") return { ...r, value: undefined };
	// (nothing was cut: nothing moved, and no note about what «moved with the cut»)
	if (!r.timelineChanged) return { ...r, value: undefined, result: r.value };
	const ed = editor();
	const total = sec(ed.timeline.getTotalDuration());
	const beds = ed.scenes.getActiveScene().tracks.audio.flatMap((t) => t.elements as TimelineElement[]).filter((e) => sec(e.startTime + e.duration) > total - 0.05 && e.duration / TICKS_PER_SECOND > 8);
	return {
		...r,
		value: undefined,
		result: r.value,
		note: `Captions, titles and sounds over the removed pieces moved with the cut; each one keeps its place over its words (a title that sat over a pause got shorter). Music beds are not cut${beds.length ? `: ${beds.map((e) => `${short(e.id)} «${e.name}» ends at ${sec(e.startTime + e.duration)} s` ).join(", ")} — fit_music {id, length} ends it with the picture` : ""}.`,
	};
}

/** No sound to clone from: what Claude passes instead, in its own arguments (A2: «Pick a saved voice» named a button). */
const noVoiceToClone = (clip: string) =>
	`There is no voice to clone in clip ${clip} (it has no sound). Give speaker (a ready voice: ${VOICES.map((v) => v.id).join(", ")}, or a saved voice's name) with text, or sound:"<Media audio id>" (a voice-over or a song; soundFrom/soundTo for its piece), or sound:"timeline" (the audio under the clip on the timeline: a song placed there is sung). Nothing was spent.`;

/**
 * The song under a clip when the Studio's «audio under the clip» has none (it leaves out music on purpose: a talking mouth
 * must not move to a beat — but a singer's voice IS the song): the piece of the first audio clip of Media that plays from
 * the clip's start, as far as both go.
 */
function songUnder(from: number, to: number): ReturnType<typeof soundOf> | null {
	for (const track of editor().scenes.getActiveScene().tracks.audio) {
		if (track.muted) continue;
		for (const el of track.elements as TimelineElement[]) {
			if (el.type !== "audio" || !("mediaId" in el) || !el.mediaId) continue;
			const s = el.startTime / TICKS_PER_SECOND;
			const e = s + el.duration / TICKS_PER_SECOND;
			if (s > from + 0.05 || e < from + 0.3) continue;
			const asset = editor().media.getAssets().find((a) => a.id === el.mediaId);
			if (!asset?.file) continue;
			const rate = el.retime?.rate ?? 1;
			const b = Math.min(to, e);
			const trim = { from: el.trimStart / TICKS_PER_SECOND + (from - s) * rate, length: (b - from) * rate };
			return { asset, trim, seconds: b - from, at: from, label: `the song under the clip (${trim.from.toFixed(2)}–${(trim.from + trim.length).toFixed(2)} s of «${asset.name}»)` };
		}
	}
	return null;
}

/** A piece of a sound as a WAV file, cut here (only the piece is sent and billed). */
async function soundPiece(asset: MediaAsset, trim: { from: number; length: number }): Promise<File> {
	const RATE = 44100;
	const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(trim.length * RATE)), RATE);
	const buffer = await ctx.decodeAudioData(await asset.file.arrayBuffer());
	const node = ctx.createBufferSource();
	node.buffer = buffer;
	node.connect(ctx.destination);
	node.start(0, trim.from, trim.length);
	const samples = (await ctx.startRendering()).getChannelData(0);
	const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
	const text = (at: number, t: string) => [...t].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)));
	text(0, "RIFF");
	out.setUint32(4, 36 + samples.length * 2, true);
	text(8, "WAVEfmt ");
	out.setUint32(16, 16, true);
	out.setUint16(20, 1, true);
	out.setUint16(22, 1, true);
	out.setUint32(24, RATE, true);
	out.setUint32(28, RATE * 2, true);
	out.setUint16(32, 2, true);
	out.setUint16(34, 16, true);
	text(36, "data");
	out.setUint32(40, samples.length * 2, true);
	for (let i = 0; i < samples.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
	return new File([out.buffer], `${asset.name.replace(/\.[^.]+$/, "")} ${trim.from.toFixed(2)}-${(trim.from + trim.length).toFixed(2)}.wav`, { type: "audio/wav" });
}

/**
 * Lipsync to a given sound (A2: the tool took only words in the clip's own voice, so a singer couldn't sing her song —
 * 7 failed calls, then $1.80 of avatars and ~28 export/import calls): the Studio's own voice modes. sound:"timeline" =
 * the audio under the clip on the timeline (a song placed there; the result plays silent over it), sound:"<Media audio id>"
 * (soundFrom/soundTo: its piece) or a timeline audio clip id (its trimmed piece) = that file as the voice, speaker = a ready
 * voice on this Mac (free) or a saved voice saying `text`; cast = the character's voice.
 */
async function lipsyncTo(args: Args, found: Found & { element: VideoElement }, signal: AbortSignal) {
	const pid = projectId();
	const ed = editor();
	const clip = short(found.element.id);
	const at = found.element.startTime / TICKS_PER_SECOND;
	const end = at + found.element.duration / TICKS_PER_SECOND;
	const sound = typeof args.sound === "string" ? args.sound.trim() : "";
	const text = String(args.text ?? "").trim();
	let speaker = typeof args.speaker === "string" ? args.speaker.trim() : "";
	if (!sound && !speaker && args.cast) speaker = (await castOf(Array.isArray(args.cast) ? args.cast.slice(0, 1) : args.cast))[0]?.voice ?? "";
	// a saved name («Ведущая» = vivian) or a ready voice; else one of the Studio's saved voices (spoken on fal, paid)
	const saved = speaker ? (await readMemory().catch(() => ({ voices: [] as Array<{ name: string; speaker: string }> }))).voices.find((v) => v.name.toLowerCase() === speaker.toLowerCase()) : undefined;
	if (saved) speaker = saved.speaker;
	const ready = speaker ? VOICES.find((v) => v.id === speaker.toLowerCase() || v.name.toLowerCase() === speaker.toLowerCase()) : undefined;
	const studioVoice = speaker && !ready ? (await studioApi.state().catch(() => null))?.voices.find((v) => v.name.toLowerCase() === speaker.toLowerCase() || v.id === speaker) : undefined;
	if (speaker && !ready && !studioVoice) fail(`No voice "${speaker}": a ready voice (${VOICES.map((v) => v.id).join(", ")}) or a saved voice's name. Nothing was spent.`);
	if (speaker && !text) fail(`speaker needs text: the words ${speaker} says. Nothing was spent.`);
	// What goes, and its seconds (the lipsync is billed by them)
	let seconds: number;
	let how: string;
	let piece: ReturnType<typeof soundOf> | null = null;
	if (sound === "timeline") {
		if (audioUnder(ed, at, end).length) {
			seconds = end - at;
			how = `the audio under clip ${clip} on the timeline`;
		} else {
			piece = songUnder(at, end) ?? fail(`No audio under clip ${clip} on the timeline (${at.toFixed(2)}–${end.toFixed(2)} s, from its start): place the song or the voice on an audio track under it, or give sound:"<Media audio id>". Nothing was spent.`);
			seconds = piece.seconds;
			how = piece.label;
		}
	} else if (sound) {
		piece = soundOf(args);
		seconds = piece.seconds;
		how = piece.label;
		const clipSeconds = end - at;
		if (!piece.trim && seconds > clipSeconds + 1) fail(`The sound is ${seconds.toFixed(1)} s and clip ${clip} is ${clipSeconds.toFixed(1)} s: give soundFrom/soundTo (seconds of the sound) for the piece to sing, a timeline audio clip id (its trimmed piece), or sound:"timeline" with the song under the clip. Nothing was spent.`);
	} else {
		seconds = speechSeconds(text);
		how = `${ready ? ready.name : studioVoice?.name}'s voice saying the text`;
	}
	const lipModel = lipsyncModelFor(args.model, seconds, pid);
	const lip = lipCost(seconds, lipModel);
	const voiceUsd = studioVoice ? voiceCost(text.length) : 0;
	// (a ready voice is spoken first by generate voice, which prices and charges itself: in the quote, not charged twice)
	const readyUsd = ready && text ? ttsPrice(text.length).cost : 0;
	const what = `lipsync of ${seconds.toFixed(1)} s to ${how} (${lipModel.title} [${lipModel.id}])`;
	const quoted = await paidStep(what, lip.cost + voiceUsd + readyUsd, lip.api, args.quote);
	if (quoted) return quoted;
	const store = useStudioStore.getState();
	select([found]);
	store.pin(pid, found.element.id);
	// this call's model, for this run only: the user's own pick in the Lipsync window comes back after it
	const pickedBefore = store.draft(pid).model;
	store.patch(pid, { text: speaker ? text : "", source: "clip", audioOnly: false, dub: undefined, model: lipModel.id });
	try {
		return await lipsyncRun();
	} finally {
		useStudioStore.getState().patch(pid, { model: pickedBefore });
	}
	async function lipsyncRun(): Promise<string> {
	if (!currentClip(ed)) fail("Select the clip first.");
	if (sound === "timeline" && !piece) await setVoiceFromTimeline(ed, pid, at, end);
	else if (piece?.trim) {
		const file = await soundPiece(piece.asset, piece.trim);
		const up = await uploadOnce(`voice-piece:${piece.asset.id}:${piece.trim.from.toFixed(3)}:${piece.trim.length.toFixed(3)}`, file);
		if (!up.hasAudio) fail(`${how} has no sound. Nothing was spent.`);
		store.patch(pid, { voice: "file", voiceName: file.name, speech: { fileId: up.fileId, name: file.name, seconds: up.duration, text: "", voiceId: "file" } });
	} else if (piece) await setVoiceFromAsset(pid, piece.asset);
	else if (ready) {
		// a ready voice: spoken first (generate voice prices and charges it), kept in Media, then the lips follow it
		const made = (await generateThing("voice", { text, speaker: ready.id, place: false })) as { media?: string };
		if (!made?.media) fail(`The voice wasn't made. Nothing was spent.`);
		await setVoiceFromAsset(pid, findMedia(made.media));
	} else if (studioVoice) {
		store.patch(pid, { voice: studioVoice.id, voiceName: studioVoice.name });
		await voiceover(ed, pid);
		const v = useStudioStore.getState().runs.voiceover;
		if (v?.error) fail(forClaude(v.error));
	}
	if (signal.aborted) throw new DOMException("Stopped", "AbortError");
	await lipsync(ed, pid);
	const l = useStudioStore.getState().runs.lipsync;
	if (l?.error) fail(forClaude(l.error));
	// the result's second 0 belongs at the clip's start; its sound: the song under it, the piece, the file or the made voice
	if (l?.result?.assetId) {
		const under = sound === "timeline" ? audioUnder(ed, at, end)[0]?.element : undefined;
		const speech = useStudioStore.getState().draft(pid).speech;
		const from = under ? under.trimStart / TICKS_PER_SECOND + (at - under.startTime / TICKS_PER_SECOND) * (under.retime?.rate ?? 1) : (piece?.trim?.from ?? 0);
		const source = under && "mediaId" in under ? under.mediaId : piece ? piece.asset.id : speech?.mediaId;
		await rememberSync(l.result.assetId, { at, ...(source ? { sound: source } : {}), soundFrom: Math.max(0, from) }).catch(() => {});
	}
	// The result stays as long as the clip it replaced. On the magnetic main track a longer one pushes everything after
	// it (a 2-s shot came back 2.5 s and moved the whole cut half a second off its song): its tail is cut back; a
	// shorter one pulled what follows earlier, and the answer says by how much.
	let moved = "";
	if (l?.result?.assetId) {
		const landed = [...ed.scenes.getActiveScene().tracks.overlay, ed.scenes.getActiveScene().tracks.main].flatMap((t) => (t.elements as TimelineElement[]).map((e) => ({ t, e }))).find((x) => (x.e as { mediaId?: string }).mediaId === l.result?.assetId && Math.abs(x.e.startTime / TICKS_PER_SECOND - at) < 0.06);
		if (landed) {
			const over = (landed.e.startTime + landed.e.duration) / TICKS_PER_SECOND - end;
			if (over > 0.02) await trimElement({ id: short(landed.e.id), end, closeGap: true, exact: true }, signal).catch(() => {});
			else if (over < -0.02 && landed.t.id === ed.scenes.getActiveScene().tracks.main.id) moved = ` The result is ${(-over).toFixed(2)} s shorter than the clip: what follows on the main track moved ${(-over).toFixed(2)} s earlier (move it back, or lengthen the clip before with trim).`;
		}
	}
	const done = `${l?.done ?? "Lipsync done; the result replaced the clip."}${moved}`;
	if (!underBudget()) return `${done} (${how}; ${lipModel.title})`;
	const newest = Object.entries(useStudioStore.getState().versions).filter(([k]) => k.startsWith(`${pid}|`)).flatMap(([, v]) => v).sort((a, b) => b.createdAt - a.createdAt)[0];
	return `${done} (${how}; ${lipModel.title} [${lipModel.id}] on ${API_LABEL[lip.api]}) ${await charged(what, voiceUsd + (newest?.cost ?? lip.cost), lip.api)}.`;
	}
}

async function speak(args: Args, mode: "lipsync" | "under", signal: AbortSignal) {
	const pid = projectId();
	const found = findVideo(args.id);
	if (mode === "lipsync" && (args.sound || args.speaker || args.cast)) return lipsyncTo(args, found, signal);
	const ed = editor();
	// the clip's own voice is cloned: a clip without sound has none (said in Claude's terms before anything is spent)
	if (findMedia(found.element.mediaId).hasAudio === false) fail(noVoiceToClone(short(found.element.id)));
	select([found]);
	const store = useStudioStore.getState();
	store.pin(pid, found.element.id);
	const text = String(args.text ?? "").trim() || fail("Give the words to say.");
	const voiceUsd = voiceCost(text.length);
	const lip = mode === "lipsync" ? lipCost(speechSeconds(text)) : { cost: 0, api: "fal" as AiApi };
	const what = mode === "lipsync" ? `lipsync of ~${Math.round(speechSeconds(text))} s` : `a voice of ${text.length} characters`;
	const quoted = await paidStep(what, voiceUsd + lip.cost, lip.cost ? lip.api : "fal", args.quote);
	if (quoted) return quoted;
	// this call's own defaults, never the panel's draft of the clip (its place, length choice, captions: audit bug 8)
	store.patch(pid, { text, voice: "clone", source: "clip", audioOnly: mode === "under", dub: undefined, place: "replace", fit: undefined, offset: 0, captions: false });
	if (!currentClip(ed)) fail("Select the clip first.");
	const span = { at: found.element.startTime / TICKS_PER_SECOND, end: (found.element.startTime + found.element.duration) / TICKS_PER_SECOND };
	await voiceover(ed, pid);
	const v = useStudioStore.getState().runs.voiceover;
	if (v?.error) fail(/no voice to clone/i.test(v.error) ? noVoiceToClone(short(found.element.id)) : forClaude(v.error));
	if (signal.aborted) throw new DOMException("Stopped", "AbortError");
	if (mode === "under") {
		voiceOnly(ed, pid);
		return `The new voice is under the clip (same voice as the clip, cloned on fal.ai).${underBudget() ? ` ${await charged(what, voiceUsd, "fal")}.` : ""}`;
	}
	await lipsync(ed, pid);
	const l = useStudioStore.getState().runs.lipsync;
	if (l?.error) fail(forClaude(l.error));
	// a longer result is cut back to the clip, as lipsyncTo does (on the magnetic main track it pushed the rest of the cut)
	const landed = l?.result?.assetId ? [...ed.scenes.getActiveScene().tracks.overlay, ed.scenes.getActiveScene().tracks.main].flatMap((t) => (t.elements as TimelineElement[]).map((e) => ({ t, e }))).find((x) => (x.e as { mediaId?: string }).mediaId === l.result?.assetId && Math.abs(x.e.startTime / TICKS_PER_SECOND - span.at) < 0.06) : undefined;
	if (landed && (landed.e.startTime + landed.e.duration) / TICKS_PER_SECOND - span.end > 0.02) await trimElement({ id: short(landed.e.id), end: span.end, closeGap: true, exact: true }, signal).catch(() => {});
	if (underBudget()) {
		// What the lipsync really cost when the run says (its version keeps fal's list price), the voice on top.
		const newest = Object.entries(useStudioStore.getState().versions).filter(([k]) => k.startsWith(`${pid}|`)).flatMap(([, v]) => v).sort((a, b) => b.createdAt - a.createdAt)[0];
		const lipUsd = newest?.cost ?? lip.cost;
		return `${l?.done ?? "Lipsync done; the result replaced the clip."} ${await charged(what, voiceUsd + lipUsd, lip.api)}.`;
	}
	return l?.done ?? "Lipsync done; the result replaced the clip.";
}

async function dub(args: Args, signal: AbortSignal) {
	const pid = projectId();
	const found = findVideo(args.id);
	select([found]);
	useStudioStore.getState().pin(pid, found.element.id);
	const clip = currentClip(editor()) ?? fail("Select the clip first.");
	const language = DUB_LANGUAGES.find((l) => l.code === args.language || l.name.toLowerCase() === String(args.language).toLowerCase()) ?? fail(`Language: one of ${DUB_LANGUAGES.map((l) => l.code).join(", ")}`);
	// The translation's length is known only after it: priced as the clip's own speech (~15 characters a second).
	const dubSeconds = clipSeconds(found.element);
	const dubVoice = voiceCost(Math.round(dubSeconds * 15));
	const dubLip = args.lipsync ? lipCost(dubSeconds) : { cost: 0, api: "fal" as AiApi };
	const dubWhat = `a dub of ${Math.round(dubSeconds)} s into ${language!.name}${args.lipsync ? " with lipsync" : ""}`;
	const dubQuote = await paidStep(dubWhat, dubVoice + dubLip.cost, dubLip.cost ? dubLip.api : "fal", args.quote);
	if (dubQuote) return dubQuote;
	const r = await translateClipSpeech({ editor: editor(), clip, language: language.code, signal, onStage: () => {} });
	applyDubText(pid, r);
	useStudioStore.getState().patch(pid, { voice: "clone", source: "clip", audioOnly: !args.lipsync });
	await voiceover(editor(), pid);
	const v = useStudioStore.getState().runs.voiceover;
	if (v?.error) fail(v.error);
	if (args.lipsync) {
		await lipsync(editor(), pid);
		const l = useStudioStore.getState().runs.lipsync;
		if (l?.error) fail(l.error);
	} else voiceOnly(editor(), pid);
	return { translated: r.text.slice(0, 400), language: language!.name, ...(underBudget() ? { spent: await charged(dubWhat, dubVoice + dubLip.cost, dubLip.api) } : {}) };
}

/** What is said, as numbered phrases with timeline times, per clip (hear-tools.ts: cached per file, instant after edits). */
async function transcript(args: Args, signal: AbortSignal) {
	return hearTranscript(args, signal);
}

/**
 * beat_markers {id, from?, to?, force?}: the beats of the clip's stretch as timeline markers, from the hearing (the file
 * heard once, cached). A pass whose tempo is more than 5 % off the beat markers already there keeps those (a tracker
 * guessing another tempo is not the song changing) and says so; a Media id answers the tempo and bars only.
 */
async function beatMarkers(args: Args, signal: AbortSignal) {
	const { findSounding, mapClip } = await import("@/hear/client");
	const s = findSounding(String(args.id ?? ""), { media: true });
	// What the hearing doesn't take (no file): the editor's own beat tracker, as the Assist button does.
	if (!s) return assist("beat_markers", args, signal);
	const { BAR_MARKER_COLOR, BEAT_MARKER_COLOR, isBeatMarker } = await import("@/assist/beat-markers");
	const { SetBookmarksCommand } = await import("@/assist/commands");
	const { frameTime } = await import("@/assist/scenes");
	const ed = editor();
	const ranged = args.from !== undefined || args.to !== undefined;
	const from = Math.max(s.start, Number(args.from ?? s.start) || s.start);
	const to = Math.min(s.end, Number(args.to ?? s.end) || s.end);
	if (to - from < 1) fail(`from..to (${Number(args.from ?? s.start).toFixed(2)}–${Number(args.to ?? s.end).toFixed(2)} s) is not inside «${s.name}» (${s.start.toFixed(2)}–${s.end.toFixed(2)} s).`);
	const m = await mapClip(s, { from, to }, { signal });
	const beats = m.grid?.beats.length ? m.grid.beats : m.beats;
	const bars = m.grid?.downbeats ?? [];
	const bpm = m.grid?.bpm ?? m.bpm;
	if (!beats.length || !(bpm > 0)) return `No clear beat in «${s.name}» ${from.toFixed(2)}–${to.toFixed(2)} s.`;
	if (s.mediaOnly) return `«${s.name}» (Media, not on the timeline): ${Math.round(bpm)} BPM, a beat every ${(60 / bpm).toFixed(3)} s; bars start at ${bars.slice(0, 24).map((b) => b.toFixed(2)).join(" ")}${bars.length > 24 ? " …" : ""} (the file's own seconds). Place it to get markers.`;
	const lo = Math.round(from * TICKS_PER_SECOND);
	const hi = Math.round(to * TICKS_PER_SECOND);
	const { markersTempo, tempoDisagrees } = await import("@/hear/music");
	const old = (ed.scenes.getActiveScene().bookmarks ?? []).filter((b) => isBeatMarker(b) && (b.time as number) >= lo && (b.time as number) < hi).map((b) => (b.time as number) / TICKS_PER_SECOND);
	const oldBpm = markersTempo(old);
	if (args.force !== true && tempoDisagrees(oldBpm, bpm)) {
		return `Kept the ${old.length} beat markers already in ${from.toFixed(2)}–${to.toFixed(2)} s (${Math.round(oldBpm)} BPM): this pass heard ${Math.round(bpm)} BPM, ${Math.round(Math.abs(bpm / oldBpm - 1) * 100)} % off — a tracker guessing another tempo, not the song changing. force:true replaces them.`;
	}
	const times = [...new Set(beats.map((b) => frameTime(ed, b) as number))].filter((t) => t >= lo && t < hi);
	const barSet = new Set(bars.map((b) => frameTime(ed, b) as number));
	ed.command.execute({
		command: new SetBookmarksCommand((current) => {
			// Earlier beat markers in this stretch are replaced; the user's own markers stay.
			const kept = current.filter((b) => !(isBeatMarker(b) && (b.time as number) >= lo && (b.time as number) < hi));
			const keptTimes = new Set(kept.map((b) => b.time as number));
			return [...kept, ...times.filter((t) => !keptTimes.has(t)).map((t) => ({ time: t, color: barSet.has(t) ? BAR_MARKER_COLOR : BEAT_MARKER_COLOR }) as Bookmark)];
		}),
	});
	return `${times.length} beat markers${barSet.size ? ` (${times.filter((t) => barSet.has(t)).length} bar starts, darker)` : ""} · ${Math.round(bpm)} BPM${ranged ? ` in ${from.toFixed(2)}–${to.toFixed(2)} s only` : ` on «${s.name}»`} — clips snap to them.${s.muted ? ` (${s.muted}: heard from its file.)` : ""}`;
}

/** Cuts time ranges out of the whole edit (every track), closing the gaps — seamless (hear-tools.ts): words whole, the
 * speaker's pause at each join, frame-exact edges, 30 ms fades; `exact` cuts the ranges as given. */
async function cutOut(args: Args, signal: AbortSignal) {
	return cutOutSeamless(args, signal);
}

/** Create with AI (Templates → My templates): a plate / template designed from the words, put at `start` as ordinary
 * AI layers on the timeline (their fields editable like any clip's) and kept in My templates. */
async function aiTemplate(args: Args, signal: AbortSignal) {
	const prompt = String(args.prompt ?? "").trim() || fail("Describe the plate or template to make.");
	const ed = editor();
	if (args.start !== undefined) ed.playback.seek({ time: at(args.start) });
	const startSeconds = ed.playback.getCurrentTime() / TICKS_PER_SECOND;
	const preset = await designLayerPreset({ editor: ed, description: prompt, signal, onStep: () => {} });
	useUserPresets.getState().addText(preset);
	await insertUserTextPreset({ editor: ed, preset });
	return `Made «${preset.name}» at ${startSeconds.toFixed(1)} s: ${preset.layers.length} AI layer(s) on the timeline (texts and colours change with set_element; get_project lists them), kept in Templates → My templates.`;
}

async function projectSettings(args: Args) {
	const ed = editor();
	const p = ed.project.getActive();
	const settings: Record<string, unknown> = {};
	if (args.fps) settings.fps = floatToFrameRate(Number(args.fps));
	let { width, height } = p.settings.canvasSize;
	const aspect = ASPECTS.find((a) => a.id === args.aspect);
	if (aspect) ({ width, height } = aspect);
	if (args.resolution) {
		const short = Number(args.resolution);
		const f = short / Math.min(width, height);
		width = Math.round((width * f) / 2) * 2;
		height = Math.round((height * f) / 2) * 2;
	}
	if (width !== p.settings.canvasSize.width || height !== p.settings.canvasSize.height) settings.canvasSize = { width, height };
	if (!Object.keys(settings).length) return "Nothing to change.";
	await ed.project.updateSettings({ settings });
	return `Project: ${width}×${height}, ${args.fps ?? Math.round(frameRateToFloat(p.settings.fps))} fps.`;
}

const SAFE_ACTIONS = new Set([
	"toggle-play", "goto-start", "goto-end", "select-all", "deselect-all", "split-all", "delete-selected", "ripple-delete",
	"duplicate-selected", "copy-selected", "paste-copied", "toggle-elements-muted-selected", "toggle-elements-visibility-selected",
	"mark-in", "mark-out", "clear-in-out", "toggle-bookmark", "add-video-track", "add-audio-track", "timeline-zoom-fit",
	"export-project", "project-settings", "show-media", "show-effects", "show-captions", "import-media", "import-link", "save-project",
]);

// ───────────────────────── the catalog ─────────────────────────

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const S = (description: string) => ({ type: "string", description });
const N = (description: string) => ({ type: "number", description });
const B = (description: string) => ({ type: "boolean", description });
const IDS = { type: "array", items: { type: "string" }, description: "Element ids" };

/** A tool answer with pictures: the loop sends the text as the tool result and the pictures right after it. */
export interface Seen {
	text: string;
	images: string[];
}

async function look(args: Args): Promise<Seen> {
	if (!canSee()) fail("Seeing the picture works in the Gaziyav app only.");
	const ed = editor();
	const end = ed.timeline.getTotalDuration() / TICKS_PER_SECOND;
	const what = String(args.what ?? "frames");
	if (what === "timeline") {
		const image = await lookAtTimeline();
		if (!image) fail("The timeline isn't on screen.");
		return { text: "The timeline as the user sees it now (tracks top to bottom, time left to right).", images: [image!] };
	}
	if (what === "media") {
		// Newest first; ids: those files; count / offset: a page (vision.ts).
		const want = Array.isArray(args.ids) ? args.ids.map(String) : typeof args.ids === "string" ? String(args.ids).split(/[,\s]+/).filter(Boolean) : typeof args.id === "string" && args.id ? [String(args.id)] : undefined;
		const page = await lookAtMedia({ ids: want, count: args.count !== undefined ? Number(args.count) : undefined, offset: args.offset !== undefined ? Number(args.offset) : undefined });
		const missing = page.missing.length ? ` No media ${page.missing.map((m) => `"${m}"`).join(", ")}.` : "";
		if (!page.image) return { text: page.count ? `Nothing to show.${missing}` : "The media pool is empty.", images: [] };
		const which = want?.length ? `${page.shown} of ${page.count} files` : `${page.count} file${page.count === 1 ? "" : "s"}, newest first${page.shown < page.count ? `: ${page.offset + 1}–${page.offset + page.shown} shown (offset ${page.offset + page.shown} for older ones)` : ""}`;
		return { text: `The media pool (${which}): each picture on grey padding inside a thin frame (the grey is not part of it); under it the id, kind, size W×H, length, then the name.${missing}`, images: [page.image] };
	}
	if (end <= 0) return { text: "The timeline is empty: nothing to see yet.", images: [] };
	if (what === "playback") {
		const from = Math.max(0, Number(args.from ?? 0));
		const to = Math.min(end, Number(args.to ?? end));
		const span = Math.max(0.1, to - from);
		const { image, times } = await watch(from, from + span, Number(args.count) || Math.min(12, Math.max(4, Math.round(span * 2))));
		return { text: `Playback ${from.toFixed(1)}–${(from + span).toFixed(1)} s as ${times.length} frames in order (time under each).`, images: [image] };
	}
	const list = (Array.isArray(args.at) ? args.at : [args.at ?? ed.playback.getCurrentTime() / TICKS_PER_SECOND]).map(Number).filter(Number.isFinite).slice(0, 4);
	const shots = await lookAt(list.length ? list : [0]);
	const images = shots.map((s) => s.src).filter((x): x is string => !!x);
	if (!images.length) fail("The preview couldn't be captured.");
	return { text: `The preview (exactly what the user sees) at ${shots.map((s) => `${s.at.toFixed(1)} s`).join(", ")}, in that order.`, images };
}

const TOOLS: Array<ToolSpec & { run: Run }> = [
	{
		name: "get_project",
		description: "The open project: size, fps, playhead, selection, every track top to bottom with its elements (ids, times in seconds), and the media in Media. Call it first and after big changes.",
		parameters: obj({}),
		run: async () => getProject(),
	},
	{
		name: "get_element",
		description: "All settings of one element: every parameter with its current value and range (position in px from the canvas centre, scale, opacity, blend, volume dB, fades, text font/size/color/stroke/shadow…), effects, speed.",
		parameters: obj({ id: S("Element id") }, ["id"]),
		run: async (a) => getElement(a),
	},
	{
		name: "set_element",
		description: "Change parameters of an element by key (keys from get_element), e.g. {\"transform.scaleX\":1.2,\"transform.scaleY\":1.2}, {\"volume\":-6}, {\"content\":\"New text\",\"color\":\"#ffcc00\"}, {\"fadeIn\":1}. In / Out motion of any visual layer (a text, shape, picture or AI layer, also inside an AI composition; the user edits it in the composition's Layers panel): {\"motion.in\":\"slideUp\",\"motion.inDur\":0.5,\"motion.out\":\"fade\",\"motion.outDur\":0.4,\"motion.ease\":\"back\"} — presets none|fade|slideLeft|slideRight|slideUp|slideDown|scale|pop|spin, ease easeOut|easeInOut|easeIn|linear|back|bounce, motion.dist = slide px. Also name, hidden. ids = several elements at once (one undo); a number may be relative: \"+=3\", \"-=3\", \"*=1.2\", \"+=20%\".",
		parameters: obj({ id: S("Element id"), ids: IDS, params: { type: "object", description: "key → value" }, name: S("New name"), hidden: B("Hide/show") }),
		run: async (a) => setElement(a),
	},
	{
		name: "move",
		description: "Move an element in time and/or to another track ('new' = a new track on top).",
		parameters: obj({ id: S("Element id"), start: N("New start, seconds"), track: S("Track id or 'new'") }, ["id"]),
		run: async (a) => moveElement(a),
	},
	{
		name: "split",
		description: "Cut at a time. Without ids: every element under that time (like the blade at the playhead). Frame-exact; inside a word or breath of a clip already heard (listen/transcript) the cut moves into the nearest pause and the answer says so; exact:true keeps the time.",
		parameters: obj({ time: N("Seconds"), ids: IDS, exact: B("Cut exactly here (no move into a pause)") }, ["time"]),
		run: (a, s) => splitAt(a, s),
	},
	{
		name: "trim",
		description: "Keep only [start, end] (timeline seconds) of an element; closeGap moves it back to where it began. Edges land in pauses of a clip already heard (never in a word or breath), frame-exact, with 30 ms sound fades; exact:true keeps the times.",
		parameters: obj({ id: S("Element id"), start: N("Keep from, seconds"), end: N("Keep until, seconds"), closeGap: B("Close the gap"), exact: B("Exactly these times") }, ["id"]),
		run: (a, s) => trimElement(a, s),
	},
	{
		name: "delete",
		description: "Delete elements; closeGap = ripple delete (later clips move left).",
		parameters: obj({ ids: IDS, closeGap: B("Ripple") }, ["ids"]),
		run: async (a) => deleteElements(a),
	},
	{ name: "duplicate", description: "Duplicate elements.", parameters: obj({ ids: IDS }, ["ids"]), run: async (a) => duplicate(a) },
	{
		name: "transcript",
		description: "What is said, as phrases with timeline times and the number #n of each phrase's first word (local speech recognition, cached per file). The script to edit by: find retakes, false starts and fluffs. Without id: every clip with speech. For pauses, breaths, stressed words and the best cut points call listen.",
		parameters: obj({ id: S("Clip id or Media id (optional)"), from: N("Timeline seconds: only the words from here"), to: N("Timeline seconds: only the words up to here") }),
		run: (a, s) => transcript(a, s),
	},
	{
		name: "cut_out",
		description: "Remove time ranges from the whole edit (all tracks cut together, gaps closed, captions stay in sync): bad takes, false starts, long pauses, boring parts. Seamless: a word more than half inside goes whole, one less than half inside stays whole, edges sit in the pauses so the join keeps the speaker's natural pause, frame-exact, 30 ms audio fades; the answer lists what moved and whether the joins sound clean. exact:true cuts the ranges as given. One undo.",
		parameters: obj({ ranges: { type: "array", items: obj({ from: N("Seconds"), to: N("Seconds") }, ["from", "to"]), description: "Timeline ranges to remove" }, exact: B("Cut exactly these ranges") }, ["ranges"]),
		run: (a, s) => cutOut(a, s),
	},
	// Claude's ears (hear-tools.ts): listen, cut_point, check_cuts, fix_sound.
	...HEAR_TOOLS,
	// Claude's production desk (produce-tools.ts): analyze_material, apply_plan, review, taste_profile.
	...PRODUCE_TOOLS,
	{
		name: "add_media",
		description: "Put a Media file (video, image, audio) on the timeline. track 'main' = the main video track; otherwise a free track. sourceFrom/duration take a piece of a long video.",
		parameters: obj({ media: S("Media id"), start: N("Timeline seconds (default: playhead)"), duration: N("Seconds"), sourceFrom: N("Seconds into the file"), track: S("'main' or omit") }, ["media"]),
		run: async (a) => addMedia(a),
	},
	{
		name: "add_text",
		description: "Add a title/text. Fine-tune it after with set_element (font, stroke, shadow, position).",
		parameters: obj({ text: S("Text"), start: N("Seconds"), duration: N("Seconds, default 3"), fontSize: N("Default 5 (a title); 3 small, 8 big, 12 at most"), color: S("#hex"), font: S("Font family"), bold: B("Bold"), position: S("top | center | bottom") }, ["text"]),
		run: async (a) => addText(a),
	},
	{ name: "list_effects", description: "Effects that can go on pictures (type, name, params). studio.color = color correction (Adjust).", parameters: obj({}), run: async () => listEffects() },
	{
		name: "add_effect",
		description: "Add an effect to a video/image/text element, optionally with params.",
		parameters: obj({ id: S("Element id"), type: S("Effect type from list_effects"), params: { type: "object" } }, ["id", "type"]),
		run: async (a) => addEffect(a),
	},
	{
		name: "set_effect",
		description: "Change params of an effect already on an element, or remove it.",
		parameters: obj({ id: S("Element id"), effect: S("Effect id or type"), params: { type: "object" }, remove: B("Remove it") }, ["id", "effect"]),
		run: async (a) => setEffect(a),
	},
	{
		name: "list_transitions",
		description: "Transitions for cuts between video clips.",
		parameters: obj({}),
		run: async () => ALL_TRANSITIONS.map((d) => ({ type: d.type, name: d.name })),
	},
	{
		name: "add_transition",
		description: "Add a transition on the cut nearest to `at` seconds (two clips back to back on one track).",
		parameters: obj({ type: S("Transition type"), at: N("Seconds near the cut") }, ["type"]),
		run: async (a) => addTransition(a),
	},
	{
		name: "auto_color",
		description: "Automatic color correction of a video/image clip.",
		parameters: obj({ id: S("Element id") }, ["id"]),
		run: (a, s) => assist("auto_color", a, s),
	},
	{
		name: "split_scenes",
		description: "Cut a video clip at every scene change.",
		parameters: obj({ id: S("Video id") }, ["id"]),
		run: (a, s) => assist("split_scenes", a, s),
	},
	{
		name: "beat_markers",
		description: "Mark the beats of a music clip as timeline markers (for cutting to the beat); from / to mark only that stretch. Beat markers already there with another tempo (> 5 % apart) are kept, not replaced (force:true replaces them). A Media id answers the tempo and bars without markers.",
		parameters: obj({ id: S("Audio/video clip id, or a Media id"), from: N("Timeline seconds"), to: N("Timeline seconds"), force: B("Replace beat markers of another tempo") }, ["id"]),
		run: (a, s) => beatMarkers(a, s),
	},
	{
		name: "remove_pauses",
		description: "Cut out silences and filler words from a talking clip, seamlessly: pauses over 400 ms are shortened to this speaker's natural pause (not to nothing), fillers go with their air, every cut inside the silence (never through a word or breath), frame-exact, 30 ms audio fades at the joins, linked sound stays in sync. One undo.",
		parameters: obj({ id: S("Video/audio id") }, ["id"]),
		run: (a, s) => assist("remove_pauses", a, s),
	},
	{
		name: "speed",
		description: `Clip speed (0.05–100×), keep pitch, optical flow (smooth slow motion, renders on ${THIS_COMPUTER}).`,
		parameters: obj({ id: S("Video id"), rate: N("e.g. 0.5, 2"), keepPitch: B("Keep voice pitch"), opticalFlow: B("Smooth slow motion") }, ["id"]),
		run: (a, s) => speed(a, s),
	},
	{ name: "freeze_frame", description: "Freeze the frame at `at` seconds for 3 s.", parameters: obj({ id: S("Video id"), at: N("Seconds") }, ["id"]), run: (a) => freeze(a) },
	{ name: "reverse", description: "Play a clip backwards (again = back to normal).", parameters: obj({ id: S("Video id") }, ["id"]), run: (a, s) => reverse(a, s) },
	{
		name: "track",
		description: "Track a face/object/subject through a clip, optionally with an effect on it: blur, pixelate (censor), spotlight, colorPop.",
		parameters: obj({ id: S("Video id"), kind: S("face | object | subject"), effect: S("none | blur | pixelate | spotlight | colorPop"), box: { type: "array", items: { type: "number" }, description: "Object: [x,y,w,h] 0–1 of the picture" } }, ["id"]),
		run: (a, s) => track(a, s),
	},
	{
		name: "follow",
		description: "Pin a text/sticker/image to a tracked object so it moves with it (off: unpin).",
		parameters: obj({ id: S("Element that follows"), clip: S("Tracked video id"), tracker: S("Tracker id (optional)"), scale: B("Grow/shrink with it"), off: B("Unpin") }, ["id"]),
		run: async (a) => follow(a),
	},
	{
		name: "make_vertical",
		description: "Reframe clips to 9:16 / 4:5 / 1:1 / 16:9 keeping the person in frame (also changes the project shape).",
		parameters: obj({ ids: IDS, aspect: S("9:16 | 4:5 | 1:1 | 16:9") }),
		run: (a, s) => reframe(a, s),
	},
	{
		name: "ai_effect",
		description: "On-device AI on a clip (free): remove_background, blur_background, color_background, enhance, denoise, upscale_2x, upscale_4x, retouch, deflicker; on its sound (video or audio clip): enhance_voice, separate_voice, voice_changer (params.voice: chipmunk, deep, monster, robot, whisper, telephone, megaphone, echo).",
		parameters: obj({ id: S("Video id"), kind: S("Effect"), params: { type: "object" } }, ["id", "kind"]),
		run: (a, s) => aiEffect(a, s),
	},
	{
		name: "face_swap",
		description: `Put another face on the person in a video clip (on fal.ai with the user's key, ~$0.20 per 5 s, takes a few minutes). face: one of the app's made-up faces hero, diva, rebel, noir, elf, viking, idol, sage, android. photo: a Media picture of a real person — only with consent:true after the user confirmed that person agreed; never public figures.`,
		parameters: obj({ id: S("Video id"), face: S("Made-up face id"), photo: S("Media id of a photo (optional)"), consent: B("The person in the photo agreed") }, ["id"]),
		run: (a, s) => oneAtATime(() => faceSwap(a, s)),
	},
	{
		name: "captions",
		description: `Captions from speech (on ${THIS_COMPUTER}). Styles: hormozi, karaoke, word-box, word-pop, clean, tiktok, neon, one-word.`,
		parameters: obj({ style: S("Style id"), language: S("auto | en | ru | …"), id: S("Clip id: only this clip (default: the whole edit)") }),
		run: (a, s) => captions(a, s),
	},
	{
		name: "lipsync",
		description: `Move the lips of the person in a video clip (paid on the user's key, ~$0.20 per 40 s; takes minutes) to: new words in their own voice (text: the voice is cloned from the clip), a ready or saved voice saying text (speaker), a sound (sound: a Media audio id — soundFrom/soundTo for its piece — or a timeline audio clip id: only its trimmed piece), or the audio under the clip on the timeline (sound:"timeline": a song placed there is sung; the result plays silent over it).`,
		parameters: obj({ id: S("Video id"), text: S("What they should say (with speaker, or in the clip's own voice)"), sound: S("'timeline' (the audio under the clip), a Media audio id, or a timeline audio clip id"), soundFrom: N("Seconds into the Media sound: the piece's start"), soundTo: N("Seconds into the Media sound: the piece's end"), speaker: S("A ready voice (ryan, vivian…) or a saved voice's name, saying text"), cast: S("A cast name: its voice says text"), model: S("A lipsync model id (price_plan {kind:'lipsync'}) or 'cheapest'; default: the one picked in Settings → AI"), quote: B("Only the price") }, ["id"]),
		run: (a, s) => oneAtATime(() => speak(a, "lipsync", s)),
	},
	{
		name: "revoice",
		description: "New words in the clip's own voice, placed under the clip (no lip change).",
		parameters: obj({ id: S("Video id"), text: S("Words") }, ["id", "text"]),
		run: (a, s) => oneAtATime(() => speak(a, "under", s)),
	},
	{
		name: "dub",
		description: "Translate a clip's speech and voice it in the same voice (lipsync: also move the lips).",
		parameters: obj({ id: S("Video id"), language: S("en, es, pt, de, fr, it, ru, zh, ja, ko…"), lipsync: B("Also lipsync") }, ["id", "language"]),
		run: (a, s) => oneAtATime(() => dub(a, s)),
	},
	{
		name: "generate_voice",
		description: "Voice-over from text with a ready voice: ryan, aiden, eric, dylan, uncle_fu (men); vivian, serena, ono_anna, sohee (women). style: excited, calm, whisper…",
		parameters: obj({ text: S("Text"), speaker: S("Voice id"), style: S("Optional"), start: N("Seconds") }, ["text"]),
		run: (a) => generateThing("voice", a),
	},
	{
		name: "find_sound",
		description: "Search the built-in music and sound effects library.",
		parameters: obj({ query: S("mood/genre/thing, e.g. 'upbeat pop', 'whoosh'"), kind: S("music | sfx") }),
		run: (a, s) => findSound(a, s),
	},
	{
		name: "add_sound",
		description: "Put a library sound/music on the timeline (music: from 0 s, fitted to the video, ducks under voices).",
		parameters: obj({ sound: S("Id from find_sound"), start: N("Seconds") }, ["sound"]),
		run: (a, s) => addSound(a, s),
	},
	{
		name: "youtube",
		description: "YouTube: a query lists videos; a link (or download:true with a query = first hit) downloads into Media. from/to = only that piece in seconds.",
		parameters: obj({ query: S("Link or search words"), download: B("Download the first hit"), from: N("Seconds"), to: N("Seconds") }, ["query"]),
		run: (a, s) => youtube(a, s),
	},
	{
		name: "web_image",
		description: "Find a free-licensed picture on the web and add it to Media.",
		parameters: obj({ query: S("What"), pick: N("Result index, default 0") }, ["query"]),
		run: (a, s) => webImage(a, s),
	},
	{
		name: "ai_template",
		description: "Create with AI: a plate, title, lower third, badge, counter or small infographic designed from the prompt and put at `start` as ordinary AI layers on the timeline (their texts and colours editable with set_element), also kept in Templates → My templates. For ready-made motion graphics prefer find_content kind=motion. Takes 10 s–4 min.",
		parameters: obj({ prompt: S("What to make: content, style, timing"), start: N("Seconds") }, ["prompt"]),
		run: (a, s) => aiTemplate(a, s),
	},
	{
		name: "project_settings",
		description: "Project frame rate, aspect (9:16, 4:5, 1:1, 16:9) and resolution (short side: 720, 1080, 1440, 2160).",
		parameters: obj({ fps: N("24, 25, 30, 50, 60"), aspect: S("Aspect"), resolution: N("Short side px") }),
		run: (a) => projectSettings(a),
	},
	{
		name: "ai_models",
		description: "fal.ai (the user's own key, paid in US dollars): the picture or video generation models with prices, durations, aspects and qualities.",
		parameters: obj({ kind: S("video | image") }, ["kind"]),
		run: async (a) => pointList(a),
	},
	{
		name: "ai_generate",
		description: "Generate a video or a picture on fal.ai (the user's key, paid in US dollars; the app asks the user to OK the price); waits until it is ready, puts it in Media and on the timeline at `start` (place:false = only Media). Only when the user asks for it; the cheapest fitting option unless they ask for quality. Tell the user what it cost.",
		parameters: obj({ kind: S("video | image"), prompt: S("What to generate, detailed"), model: S("Model id from ai_models (optional)"), mode: S("video: text | image | frames | reference | motion | edit | avatar | extend"), duration: N("Seconds (video)"), aspect: S("9:16, 16:9, 1:1…"), quality: S("480p, 720p or 1080p (video)"), from: S("Media id(s) of pictures to start from, comma-separated: the video's first frame (image → video) or a reference for an image"), end: S("Media picture id: the last frame (mode frames)"), refs: S("Media picture ids: references (mode reference; an image's references)"), cast: S("Cast names whose pictures are the references"), clip: S("Media or timeline clip id (motion, edit, extend)"), sound: S("avatar: a Media sound id, or a timeline audio clip id (only its trimmed piece is sent and billed)"), soundFrom: N("avatar: seconds into the Media sound, the piece's start"), soundTo: N("avatar: seconds into the Media sound, the piece's end"), seed: N("Seed"), negative: S("What to avoid"), audio: B("Video with sound"), start: N("Timeline seconds"), track: S("'new' (a new track under the titles) or a video track id"), place: B("Put it on the timeline (default true)"), again: B("A new take of a request already made (otherwise the same request returns that result, nothing charged)"), quote: B("Only the price (nothing is uploaded)") }, ["kind"]),
		run: (a, s) => pointGenerate(a, s),
	},
	{
		name: "find_graphic",
		description: "Search the built-in animated graphics (Stickers tab): callouts, titles, lower thirds, arrows, social, countdown, celebrate, emoji, status. English keywords and/or a category.",
		parameters: obj({ query: S("English keywords, e.g. 'arrow', 'subscribe', 'fire'"), category: S("Category (optional)") }),
		run: async (a) => findGraphic(a),
	},
	{
		name: "add_graphic",
		description: "Put a graphic from find_graphic on the timeline at `start` (sized and placed like the Stickers tab does).",
		parameters: obj({ graphic: S("Graphic id from find_graphic"), start: N("Seconds") }, ["graphic"]),
		run: async (a) => addGraphic(a),
	},
	{
		name: "add_text_style",
		description: `A styled text from the Text tab's designs with your words: ${TEXT_PRESETS.map((p) => `${p.id} (${p.group}: ${p.name})`).join(", ")}.`,
		parameters: obj({ style: S("Style id"), text: S("The words"), start: N("Seconds (default: the style's own place)"), duration: N("Seconds") }, ["style"]),
		run: async (a) => addTextStyle(a),
	},
	{
		name: "local_files",
		description: "Find the user's own video, picture and audio files on this Mac by name (Movies, Downloads, Desktop, Pictures, Music, Documents; newest first). Empty query = the newest files.",
		parameters: obj({ query: S("Words in the file name"), kind: S("video | image | audio") }),
		run: (a, s) => localFiles(a, s),
	},
	{
		name: "import_file",
		description: "Import one of the user's files (a path from local_files) into Media.",
		parameters: obj({ path: S("Path from local_files") }, ["path"]),
		run: (a, s) => importFile(a, s),
	},
	{
		name: "web_search",
		description: "Look up facts on the web (Wikipedia, in the query's language): who/what/when, numbers, places — for titles, captions and explainers. Use it instead of guessing facts.",
		parameters: obj({ query: S("What to look up"), lang: S("Wikipedia language, e.g. ru, en (optional)") }, ["query"]),
		run: (a, s) => webSearch(a, s),
	},
	{
		name: "look",
		description:
			"See the project as the user sees it. what='frames': the preview at the times in `at` (up to 4); what='playback': frames spread over from..to in one strip, to judge pacing, cuts, motion and readability; what='timeline': the timeline panel; what='media': the media pool newest first with ids, kinds, W×H and names (ids: those files; count / offset: a page). Look before choosing clips or places, and after every visual change (text, effects, compositions, framing, captions) to check it and fix what is off.",
		parameters: obj({ what: S("frames | playback | timeline | media"), at: { type: "array", items: { type: "number" }, description: "Seconds (frames)" }, from: N("Seconds (playback)"), to: N("Seconds (playback)"), count: N("Frames in the strip, 4–16 (playback); media: how many of the newest (default 24)"), ids: { type: "array", items: { type: "string" }, description: "media: these Media ids" }, offset: N("media: skip this many of the newest") }),
		run: async (a) => look(a),
	},
	{
		name: "playhead",
		description: "Move the playhead, play/pause, or select elements so the user sees them.",
		parameters: obj({ time: N("Seconds"), play: B("true play / false pause"), select: IDS }),
		run: async (a) => {
			const ed = editor();
			if (a.time !== undefined) ed.playback.seek({ time: at(a.time) });
			if (Array.isArray(a.select)) select(ids(a.select).map(find));
			if (a.play === true) ed.playback.play();
			if (a.play === false) ed.playback.pause();
			return "OK.";
		},
	},
	{
		name: "undo",
		description: "Undo (or redo) the last steps.",
		parameters: obj({ steps: N("Default 1"), redo: B("Redo instead") }),
		run: async (a) => {
			const n = Math.min(50, Math.max(1, Number(a.steps) || 1));
			for (let i = 0; i < n; i++) (a.redo ? editor().command.redo() : editor().command.undo());
			return `${a.redo ? "Redid" : "Undid"} ${n}.`;
		},
	},
	{
		name: "action",
		description: `Run an editor command: ${[...SAFE_ACTIONS].join(", ")}. export-project opens the Export window (the user presses Export).`,
		parameters: obj({ name: S("Command") }, ["name"]),
		run: async (a) => {
			const name = String(a.name);
			if (!SAFE_ACTIONS.has(name)) fail(`Unknown command. One of: ${[...SAFE_ACTIONS].join(", ")}`);
			(invokeAction as (action: string) => void)(name);
			return "Done.";
		},
	},
];

export const TOOL_SPECS = TOOLS.map(({ name, description, parameters }) => ({ type: "function", function: { name, description, parameters } }));

/** A short line for the chat («Split at 3.2 s»), from the call itself. */
export function stepLabel(name: string, args: Args): string {
	const s = (v: unknown) => `${Math.round(Number(v) * 10) / 10} s`;
	switch (name) {
		case "get_project":
			return "Looking at the timeline";
		case "ai_models":
			return "Choosing an AI model";
		case "ai_generate":
			return `Generating ${args.kind === "image" ? "a picture" : "a video"} on fal.ai`;
		case "look":
			return args.what === "playback" ? "Watching the playback" : args.what === "timeline" ? "Looking at the timeline" : args.what === "media" ? "Looking through Media" : "Looking at the frame";
		case "transcript":
			return "Reading the speech";
		case "cut_out":
			return "Cutting out pieces";
		case "find_graphic":
			return "Looking for graphics";
		case "add_graphic":
			return "Adding a graphic";
		case "add_text_style":
			return "Adding a title";
		case "local_files":
			return "Looking through your files";
		case "import_file":
			return "Importing your file";
		case "web_search":
			return "Searching the web";
		case "get_element":
			return "Reading the settings";
		case "set_element":
			return "Changing settings";
		case "move":
			return args.start !== undefined ? `Moving to ${s(args.start)}` : "Moving";
		case "split":
			return `Cutting at ${s(args.time)}`;
		case "trim":
			return "Trimming";
		case "delete":
			return "Deleting";
		case "add_media":
			return "Adding to the timeline";
		case "add_text":
			return `Text “${String(args.text ?? "").slice(0, 24)}”`;
		case "add_effect":
			return "Adding an effect";
		case "add_transition":
			return "Adding a transition";
		case "youtube":
			return args.download || /youtu/.test(String(args.query)) ? "Downloading from YouTube" : "Searching YouTube";
		case "generate_voice":
			return "Voicing the text";
		case "captions":
			return "Making captions";
		case "lipsync":
			return "Lipsync";
		case "dub":
			return "Translating and dubbing";
		case "ai_template":
			return "Create with AI";
		case "face_swap":
			return "Swapping the face";
		case "ai_effect":
			return `AI: ${String(args.kind ?? "").replace(/_/g, " ")}`;
		case "track":
			return `Tracking the ${args.kind ?? "face"}`;
		case "make_vertical":
			return `Reframing to ${args.aspect ?? "9:16"}`;
		case "find_sound":
			return "Looking for music";
		case "add_sound":
			return "Adding music";
		default:
			return PRODUCE_STEP_LABELS[name] ?? name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
	}
}

export async function runTool(name: string, rawArgs: string, signal: AbortSignal): Promise<{ ok: boolean; content: string; images?: string[] }> {
	const tool = TOOLS.find((t) => t.name === name);
	if (!tool) return { ok: false, content: `Unknown tool ${name}.` };
	let args: Args = {};
	try {
		args = rawArgs ? (JSON.parse(rawArgs) as Args) : {};
	} catch {
		return { ok: false, content: "The arguments weren't valid JSON." };
	}
	try {
		const out = await tool.run(args, signal);
		if (out && typeof out === "object" && Array.isArray((out as Seen).images) && typeof (out as Seen).text === "string") {
			return { ok: true, content: (out as Seen).text, images: (out as Seen).images };
		}
		const text = typeof out === "string" ? out : JSON.stringify(out);
		if (text.length <= 12000) return { ok: true, content: text };
		// Too long: cut at an item's end and say how to get the rest (never a JSON cut mid-word that reads as data).
		const cut = Math.max(text.lastIndexOf("},", 12000), text.lastIndexOf("\n", 12000), text.lastIndexOf(", ", 12000), 8000);
		return { ok: true, content: `${text.slice(0, cut + 1)} …(cut here: ${text.length - cut - 1} more characters; ask for a part: one id, one track or a shorter range)` };
	} catch (error) {
		if ((error as Error).name === "AbortError") throw error;
		return { ok: false, content: `Error: ${(error as Error).message || String(error)}` };
	}
}

export const parseToolArgs = (raw: string): Args => {
	try {
		return JSON.parse(raw || "{}") as Args;
	} catch {
		return {};
	}
};


// Lets the app's self-tests call each tool the way Gaziyav AI does, without a model in the loop (like __studioBridge).
if (typeof window !== "undefined") {
	(window as unknown as { __agentTools: unknown }).__agentTools = { run: runTool, specs: TOOL_SPECS };
}

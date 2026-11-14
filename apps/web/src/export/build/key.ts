// Export as a build: what a stretch of the film is, as a key (render, 11.11). Two exports give a stretch the same key
// only when everything that can change its pixels is the same — then, and only then, the kept stretch is used again.
//
// A stretch's key is made of:
//  · the app's own build and what encodes the picture (the server's salt, the browser, the encoder's settings);
//  · the project's canvas and background, the export's size, rate and bit rate;
//  · every element of the picture's tracks that is on screen in the stretch or within reach of it (a transition
//    reaches across its cut), whole — every field it has, also ones added after this was written — with its start
//    counted from the stretch's start, the track it is on and its place in the stack;
//  · the transitions between those elements;
//  · every media file those elements name, and the files made from them: what the file is (size, length, frame size)
//    and what it holds (a hash of its first and last 64 KB).
// Times are counted from the stretch's own start, so a part of the film that only moved (something before it got
// shorter by whole frames) keeps its keys. Anything this does not know about is caught by looking: the first frame of
// kept stretches is drawn again and compared (build/fingerprint.ts) before they are trusted.
//
// The sound is one key for the whole mix (it is encoded once, whole: nothing to join, nothing to click): every element
// that makes sound, whole and at its own time, its files, and the mix settings.

/** Bumped when the way keys are made or stretches are stored changes: every kept stretch is then made again. */
export const KEY_VERSION = 1;

import { sha256 } from "./sha256";

type Plain = Record<string, unknown>;

const isBlob = (value: unknown): value is Blob => typeof Blob !== "undefined" && value instanceof Blob;

/**
 * A value as text that is the same for the same content: object keys in order, nothing that isn't data (functions,
 * undefined, decoded sound), a file as its size and type, object URLs (new on every start) as a mark.
 * `drop`: keys left out at the top level.
 */
export function canonical(value: unknown, drop?: ReadonlySet<string>): string {
	if (value === null || value === undefined) return "null";
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "string") return JSON.stringify(value.startsWith("blob:") ? "blob:" : value);
	if (typeof value === "bigint") return `"${value}n"`;
	if (typeof value === "function" || typeof value === "symbol") return "null";
	if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
	if (ArrayBuffer.isView(value)) {
		const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		let hash = 2166136261;
		for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 16777619);
		return `"bytes:${bytes.length}:${hash >>> 0}"`;
	}
	if (isBlob(value)) return `{"blob":${value.size},"type":${JSON.stringify(value.type)}}`;
	if (typeof AudioBuffer !== "undefined" && value instanceof AudioBuffer) return "null";
	if (value instanceof Date) return String(value.getTime());
	if (value instanceof Map) return canonical(Object.fromEntries(value));
	if (value instanceof Set) return canonical([...value].sort());
	const object = value as Plain;
	const parts: string[] = [];
	for (const key of Object.keys(object).sort()) {
		if (drop?.has(key)) continue;
		const item = object[key];
		if (item === undefined || typeof item === "function") continue;
		parts.push(`${JSON.stringify(key)}:${canonical(item)}`);
	}
	return `{${parts.join(",")}}`;
}


/** A media record: its id, its file, and whatever else it carries (all of it is part of what the file is). */
export interface AssetLike {
	id: string;
	file?: Blob;
}

const HEAD_BYTES = 64 * 1024;
/** What a file holds, by its first and last 64 KB (and its size): the same for the same file on every start. */
const contentMarks = new Map<Blob, Promise<string>>();
function contentMark(file: Blob): Promise<string> {
	let mark = contentMarks.get(file);
	if (!mark) {
		mark = (async () => {
			const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
			const tail = file.size > HEAD_BYTES ? new Uint8Array(await file.slice(Math.max(HEAD_BYTES, file.size - HEAD_BYTES)).arrayBuffer()) : new Uint8Array(0);
			const both = new Uint8Array(head.length + tail.length);
			both.set(head);
			both.set(tail, head.length);
			// (the browser's own digest: these are the only large inputs, a few per file)
			const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", both as unknown as ArrayBuffer));
			let hex = "";
			for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
			return `${file.size}:${hex}`;
		})();
		contentMarks.set(file, mark);
		// (a mark is remembered for as long as the page holds the file object)
		if (contentMarks.size > 2000) contentMarks.delete(contentMarks.keys().next().value as Blob);
	}
	return mark;
}

/** Fields of a media record that say nothing about its picture or sound, or change from start to start. */
const ASSET_DROP = new Set(["file", "url", "thumbnailUrl", "name", "lastModified", "attribution", "origin", "ephemeral"]);

/** Each media file as what it is and what it holds: id → text. A file that can't be read gives a mark of its own. */
export async function assetIdentities(assets: readonly AssetLike[]): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	await Promise.all(
		assets.map(async (asset) => {
			const mark = asset.file ? await contentMark(asset.file).catch(() => `unreadable:${Math.random()}`) : "no-file";
			out.set(asset.id, `${canonical(asset, ASSET_DROP)}#${mark}`);
		}),
	);
	return out;
}

interface ElementLike {
	id: string;
	startTime: number;
	duration: number;
	[key: string]: unknown;
}
interface TrackLike {
	id: string;
	elements: readonly ElementLike[];
	transitions?: readonly Plain[];
	[key: string]: unknown;
}
export interface TracksLike {
	overlay: readonly TrackLike[];
	main: TrackLike;
	audio: readonly TrackLike[];
}

/** Fields of an element that never reach the picture or the sound (its start is counted from the stretch instead). */
const ELEMENT_DROP = new Set(["startTime", "name", "groupId", "beats", "buffer"]);
/**
 * What of a clip is heard and never seen (Inspector → Audio: level, pan, mute, fades, the voice's role, the audio
 * effects «fx.…», and the keys of level and pan). A change in them leaves the picture's keys alone — turning a clip
 * down does not render its frames again; the mix has its own key, made of the whole element.
 */
const AUDIO_PARAM = /^(volume|pan|muted|fadeIn|fadeOut|duckUnderVoice|voiceRole)$|^fx\./;
const AUDIO_ANIMATION = /^(volume|pan)$/;
const without = (bag: unknown, heard: RegExp): Plain | undefined => {
	if (!bag || typeof bag !== "object") return undefined;
	const kept = Object.entries(bag as Plain).filter(([key]) => !heard.test(key));
	return kept.length ? Object.fromEntries(kept) : undefined;
};
/** The element as the picture knows it. */
export function pictureOf(element: ElementLike): Plain {
	if (element.type !== "video" && element.type !== "audio") return element;
	const { isSourceAudioEnabled: _heard, ...seen } = element as Plain;
	return { ...seen, params: without(element.params, AUDIO_PARAM), animations: without(element.animations, AUDIO_ANIMATION) };
}

/** Fields of a track that never reach the picture (its elements and transitions go in one by one). */
const TRACK_DROP = new Set(["elements", "transitions", "name", "locked", "muted"]);

export interface VideoKeyInput {
	tracks: TracksLike;
	assets: readonly AssetLike[];
	/** start and length of each stretch, in frames */
	ranges: readonly { start: number; frames: number }[];
	ticksPerFrame: number;
	ticksPerSecond: number;
	/** everything that is the same for every stretch of this export (build, encoder, canvas, size, rate …) */
	global: unknown;
}

/** The longest reach of a transition (ticks): a stretch's key takes in the elements this far before and after it. */
export function transitionReach(tracks: TracksLike, ticksPerSecond: number): number {
	let reach = ticksPerSecond;
	for (const track of [...tracks.overlay, tracks.main]) {
		for (const transition of track.transitions ?? []) {
			if (typeof transition.duration === "number" && transition.duration > reach) reach = transition.duration;
		}
		// a transition on an adjustment layer runs over the layer's whole span
		for (const element of track.elements) if (element.transition && element.duration > reach) reach = element.duration;
	}
	return reach;
}

/** One key per stretch (hex). */
export async function videoKeys({ tracks, assets, ranges, ticksPerFrame, ticksPerSecond, global }: VideoKeyInput): Promise<string[]> {
	const identities = new Map([...(await assetIdentities(assets))].map(([id, text]) => [id, sha256(text)]));
	const assetIds = [...identities.keys()];
	// media made from other media (smooth-motion pictures, an editing copy's original, AI results) go with what they are made from
	const assetText = new Map(assets.map((asset) => [asset.id, canonical(asset, ASSET_DROP)]));
	const madeFrom = new Map<string, string[]>();
	for (const [id, text] of assetText) {
		for (const other of assetIds) {
			if (other !== id && text.includes(other)) madeFrom.set(other, [...(madeFrom.get(other) ?? []), id]);
		}
	}
	const visual = [...tracks.overlay, tracks.main];
	const prepared = visual.map((track, index) => {
		const elements = [...track.elements]
			.sort((a, b) => a.startTime - b.startTime || (a.id < b.id ? -1 : 1))
			.map((element) => {
				const body = canonical(pictureOf(element), ELEMENT_DROP);
				const names = new Set<string>();
				for (const id of assetIds) {
					if (!body.includes(id)) continue;
					names.add(id);
					for (const made of madeFrom.get(id) ?? []) names.add(made);
				}
				return { element, end: element.startTime + element.duration, hash: sha256(body), assets: [...names] };
			});
		// (sorted by start; the longest element bounds how far back a stretch has to look)
		const longest = elements.reduce((max, { element }) => Math.max(max, element.duration), 0);
		const transitions = (track.transitions ?? []).map((transition) => ({ text: canonical(transition), hash: sha256(canonical(transition)) }));
		return { index, head: sha256(canonical(track, TRACK_DROP)), elements, longest, transitions };
	});
	const reach = transitionReach(tracks, ticksPerSecond);
	const globalText = sha256(canonical({ v: KEY_VERSION, global, ticksPerFrame, ticksPerSecond }));
	const keys: string[] = [];
	for (const range of ranges) {
		const t0 = range.start * ticksPerFrame;
		const t1 = (range.start + range.frames) * ticksPerFrame;
		const lines: string[] = [globalText, `F${range.frames}`];
		const named = new Set<string>();
		for (const track of prepared) {
			lines.push(`T${track.index}:${track.head}`);
			// the elements on screen in the stretch or within a transition's reach of it (found by start: they are in order)
			const list = track.elements;
			let low = 0;
			let high = list.length;
			const from = t0 - reach - track.longest;
			while (low < high) {
				const mid = (low + high) >> 1;
				if (list[mid].element.startTime < from) low = mid + 1;
				else high = mid;
			}
			const ids: string[] = [];
			for (let i = low; i < list.length && list[i].element.startTime < t1 + reach; i++) {
				const { element, end, hash, assets: names } = list[i];
				if (end <= t0 - reach) continue;
				lines.push(`E${track.index}:${hash}@${element.startTime - t0}`);
				ids.push(element.id);
				for (const id of names) named.add(id);
			}
			for (const transition of track.transitions) {
				if (ids.some((id) => transition.text.includes(id))) lines.push(`X${track.index}:${transition.hash}`);
			}
		}
		for (const id of [...named].sort()) lines.push(`A:${identities.get(id) ?? id}`);
		keys.push(sha256(lines.join("\n")));
	}
	return keys;
}

/** The whole mix's key: every element that makes sound (whole, at its own time), its files, the mix settings. */
export async function audioKey({ elements, tracks, assets, global }: { elements: readonly ElementLike[]; tracks: TracksLike; assets: readonly AssetLike[]; global: unknown }): Promise<string> {
	const identities = await assetIdentities(assets);
	const ids = [...identities.keys()];
	const lines: string[] = [canonical({ v: KEY_VERSION, global })];
	const named = new Set<string>();
	// which track an element is on, and whether that track is muted, is part of what is heard
	const trackOf = new Map<string, string>();
	for (const track of [...tracks.overlay, tracks.main, ...tracks.audio]) {
		for (const element of track.elements) trackOf.set(element.id, canonical({ type: track.type, muted: track.muted }));
	}
	for (const element of [...elements].sort((a, b) => a.startTime - b.startTime || (a.id < b.id ? -1 : 1))) {
		const body = canonical(element, new Set(["name", "groupId", "beats", "buffer"]));
		lines.push(`E:${trackOf.get(element.id) ?? ""}:${body}`);
		for (const id of ids) if (body.includes(id)) named.add(id);
	}
	for (const id of [...named].sort()) lines.push(`A:${identities.get(id) ?? id}`);
	return sha256(lines.join("\n"));
}

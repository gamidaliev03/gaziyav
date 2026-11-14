import { describe, expect, test } from "bun:test";
import type { SceneTracks, TimelineElement } from "@/timeline/types";
import type { LinkageKind } from "@/timeline/timeline-store";
import { applyLinkage } from "../linkage";
import { applyLinkageReference } from "./linkage-reference";

// speed, 11.11: the linkage's lookups were given indexes (the main clip under a moment, a caption's clip, the speech
// around it, a voice's track). The linkage has many rules, each from a user's bug: the indexed code must give the old
// code's answer on every timeline — here on thousands of random ones and random edits of them, long and short tracks,
// split pieces, captions over pictures and over voices, overlapping and one-tick clips (which the index refuses).

type El = Record<string, unknown> & { id: string; type: string; startTime: number; duration: number };

function random(seed: number) {
	let state = seed % 2147483647 || 1;
	const next = () => {
		state = (state * 16807) % 2147483647;
		return state / 2147483647;
	};
	return { next, int: (n: number) => Math.floor(next() * n), chance: (p: number) => next() < p, pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] };
}

const ALL_KINDS: LinkageKind[] = ["text", "sticker", "effect", "audio", "overlay"] as LinkageKind[];

function makeScene(rnd: ReturnType<typeof random>, { long, messy }: { long: boolean; messy: boolean }): SceneTracks {
	const unit = rnd.pick([1, 10, 1000]);
	// the main track: runs of pieces split from a few sources, some gaps
	const main: El[] = [];
	let at = 0;
	const runs = long ? 6 + rnd.int(30) : 1 + rnd.int(4);
	let n = 0;
	for (let r = 0; r < runs; r++) {
		const mediaId = `m${rnd.int(4)}`;
		let trim = rnd.int(50) * unit;
		const pieces = 1 + rnd.int(long ? 12 : 3);
		const rate = rnd.chance(0.15) ? rnd.pick([0.5, 2]) : 1;
		for (let k = 0; k < pieces; k++) {
			const duration = (2 + rnd.int(40)) * unit;
			const clip: El = { id: `c${n++}`, type: "video", name: "clip", mediaId, startTime: at, duration, trimStart: trim, trimEnd: 0, isSourceAudioEnabled: !rnd.chance(0.1), params: {} };
			if (rate !== 1) clip.retime = { rate };
			main.push(clip);
			at += duration;
			// the next piece plays on from this one, or a part of the source was cut out between them
			trim += duration * rate + (rnd.chance(0.3) ? rnd.int(30) * unit : 0);
		}
		if (rnd.chance(0.25)) at += rnd.int(20) * unit;
	}
	if (messy) {
		// what the index refuses: an overlap, a one-tick clip, a clip that starts a tick late
		if (rnd.chance(0.5) && main.length > 2) main[1 + rnd.int(main.length - 1)].startTime -= rnd.int(3) * unit + 1;
		if (rnd.chance(0.5)) main.push({ id: `c${n++}`, type: "video", name: "clip", mediaId: "m0", startTime: at, duration: 1, trimStart: 0, trimEnd: 0, params: {} });
		if (rnd.chance(0.5) && main.length > 3) main[2].startTime += 1;
	}
	const total = Math.max(at, 10 * unit);
	// sound: voices (uploads), library music, detached sound in lockstep with a clip
	const audio: El[] = [];
	const voices = rnd.int(long ? 14 : 4);
	let va = rnd.int(10) * unit;
	for (let v = 0; v < voices; v++) {
		const duration = (5 + rnd.int(60)) * unit;
		audio.push({ id: `v${v}`, type: "audio", name: "voice", sourceType: rnd.chance(0.85) ? "upload" : "library", mediaId: `a${rnd.int(3)}`, startTime: va, duration, trimStart: rnd.int(20) * unit, trimEnd: 0, params: {} });
		va += duration + (rnd.chance(0.5) ? 0 : rnd.int(20) * unit);
	}
	const audio2: El[] = [];
	for (const clip of main) {
		if (clip.isSourceAudioEnabled === false && rnd.chance(0.7)) {
			audio2.push({ id: `d-${clip.id}`, type: "audio", name: "sound", sourceType: "upload", mediaId: clip.mediaId, startTime: clip.startTime, duration: clip.duration, trimStart: clip.trimStart, trimEnd: 0, ...(clip.retime ? { retime: clip.retime } : {}), params: {} });
		}
	}
	// over them: captions (with and without the clip they were heard in), titles, pictures, effects
	const everyId = [...main, ...audio].map((element) => element.id);
	const captions: El[] = [];
	const count = long ? 20 + rnd.int(120) : rnd.int(8);
	for (let i = 0; i < count; i++) {
		const startTime = rnd.int(Math.max(1, Math.round(total / unit) + 10)) * unit + (rnd.chance(0.1) ? 0.5 : 0);
		const params: Record<string, unknown> = rnd.chance(0.8) ? { "caption.style": "caption" } : {};
		if (rnd.chance(0.3)) params["caption.source"] = rnd.chance(0.9) ? rnd.pick(everyId) : "gone";
		captions.push({ id: `t${i}`, type: "text", name: rnd.chance(0.1) ? `Caption ${i}` : `t${i}`, startTime, duration: (1 + rnd.int(12)) * unit, params });
	}
	const layer: El[] = [];
	for (let i = 0; i < (long ? 10 + rnd.int(20) : rnd.int(5)); i++) {
		const type = rnd.pick(["image", "video", "sticker", "effect", "graphic"]);
		layer.push({ id: `o${i}`, type, name: type, ...(type === "video" || type === "image" ? { mediaId: `m${rnd.int(4)}`, trimStart: rnd.int(10) * unit, trimEnd: 0 } : {}), startTime: rnd.int(Math.max(1, Math.round(total / unit))) * unit, duration: (1 + rnd.int(30)) * unit, params: {} });
	}
	return {
		main: { id: "main", type: "video", name: "Main", elements: main },
		overlay: [
			{ id: "captions", type: "text", name: "Captions", elements: captions },
			{ id: "layer", type: "video", name: "Layer", elements: layer },
		],
		audio: [
			{ id: "voices", type: "audio", name: "Voices", elements: audio },
			{ id: "sound", type: "audio", name: "Sound", elements: audio2 },
		],
	} as unknown as SceneTracks;
}

/** A random edit of the timeline: what a command leaves before the linkage runs. */
function edit(rnd: ReturnType<typeof random>, before: SceneTracks): SceneTracks {
	const copy = (elements: readonly unknown[]) => (elements as El[]).map((element) => ({ ...element }));
	let main = copy(before.main.elements);
	const overlay = before.overlay.map((track) => ({ ...track, elements: copy(track.elements) }));
	const audio = before.audio.map((track) => ({ ...track, elements: copy(track.elements) }));
	const ripple = (from: number, by: number) => {
		for (const clip of main) if (clip.startTime >= from) clip.startTime += by;
	};
	const steps = 1 + rnd.int(3);
	for (let s = 0; s < steps && main.length > 0; s++) {
		const clip = rnd.pick(main);
		const op = rnd.int(11);
		if (op === 0) {
			// delete, with or without the magnet
			main = main.filter((other) => other !== clip);
			if (rnd.chance(0.7)) ripple(clip.startTime, -clip.duration);
		} else if (op === 1) {
			// trim the head (start and trim move together), the magnet may close up
			const cut = Math.min(clip.duration - 2, 1 + rnd.int(Math.max(1, Math.floor(clip.duration / 2))));
			if (cut > 0) {
				clip.trimStart = ((clip.trimStart as number) ?? 0) + cut * (((clip.retime as { rate: number } | undefined)?.rate) ?? 1);
				clip.duration -= cut;
				if (rnd.chance(0.5)) ripple(clip.startTime + 1, -cut);
				else clip.startTime += cut;
			}
		} else if (op === 2) {
			// trim the tail
			const cut = Math.min(clip.duration - 2, 1 + rnd.int(Math.max(1, Math.floor(clip.duration / 2))));
			if (cut > 0) {
				clip.duration -= cut;
				if (rnd.chance(0.6)) ripple(clip.startTime + 1, -cut);
			}
		} else if (op === 3) {
			// split
			const where = 1 + rnd.int(Math.max(1, clip.duration - 2));
			if (where > 0 && where < clip.duration) {
				const rate = ((clip.retime as { rate: number } | undefined)?.rate) ?? 1;
				const right = { ...clip, id: `${clip.id}s${s}`, startTime: clip.startTime + where, duration: clip.duration - where, trimStart: ((clip.trimStart as number) ?? 0) + where * rate };
				clip.duration = where;
				main.splice(main.indexOf(clip) + 1, 0, right);
			}
		} else if (op === 4) {
			// move everything from here
			ripple(clip.startTime, (rnd.int(40) - 10) * 3);
		} else if (op === 5) {
			// a speed change: the start stays
			const rate = rnd.pick([0.5, 2, 4]);
			const was = ((clip.retime as { rate: number } | undefined)?.rate) ?? 1;
			const length = Math.max(2, Math.round((clip.duration * was) / rate));
			ripple(clip.startTime + 1, length - clip.duration);
			clip.duration = length;
			clip.retime = { rate };
		} else if (op === 6) {
			// replaced in place by a new clip
			main[main.indexOf(clip)] = { ...clip, id: `${clip.id}r${s}`, mediaId: "fresh" };
		} else if (op === 7) {
			// onto a layer track
			main = main.filter((other) => other !== clip);
			overlay[1].elements.push(clip);
		} else if (op === 8 && audio[0].elements.length > 0) {
			// a voice moved, trimmed, sped up or deleted
			const voice = rnd.pick(audio[0].elements);
			const kind = rnd.int(4);
			if (kind === 0) voice.startTime = Math.max(0, voice.startTime + (rnd.int(30) - 10) * 2);
			else if (kind === 1) voice.duration = Math.max(2, voice.duration - rnd.int(Math.max(1, Math.floor(voice.duration / 2))));
			else if (kind === 2) {
				voice.retime = { rate: 2 };
				voice.duration = Math.max(2, Math.round(voice.duration / 2));
			} else audio[0].elements = audio[0].elements.filter((other) => other !== voice);
		} else if (op === 9) {
			// the edit moved or deleted some items itself
			const track = rnd.pick(overlay);
			if (track.elements.length > 0) {
				const item = rnd.pick(track.elements);
				if (rnd.chance(0.5)) item.startTime += 5;
				else track.elements = track.elements.filter((other) => other !== item);
			}
		} else {
			// the order of the track's list changed (a paste, a sort)
			main.reverse();
		}
	}
	return { main: { ...before.main, elements: main }, overlay, audio } as unknown as SceneTracks;
}

describe("linkage with indexes gives the old linkage's answer", () => {
	for (const [name, options, rounds] of [
		["long tracks of split pieces", { long: true, messy: false }, 1200],
		["short tracks", { long: false, messy: false }, 1500],
		["tracks the index refuses (overlaps, one-tick clips)", { long: true, messy: true }, 800],
	] as const) {
		test(`${name}: ${rounds} random timelines and edits`, () => {
			const rnd = random(name.length * 7919);
			let followed = 0;
			for (let round = 0; round < rounds; round++) {
				const before = makeScene(rnd, options);
				const after = edit(rnd, before);
				const kinds = new Set<LinkageKind>(rnd.chance(0.6) ? ALL_KINDS : ALL_KINDS.filter(() => rnd.chance(0.5)));
				const expected = applyLinkageReference({ before, after, kinds });
				const got = applyLinkage({ before, after, kinds });
				if (expected !== after) followed++;
				// the same answer, and «nothing follows» is the same object in both
				expect(got === after).toBe(expected === after);
				expect(JSON.stringify(got)).toBe(JSON.stringify(expected));
			}
			// the edits did make things follow (the test is not comparing no-ops)
			expect(followed).toBeGreaterThan(rounds / 3);
		});
	}
});

describe("the cost of one edit's linkage on a long talk", () => {
	// A talking clip split into pieces that still play on from one another, captions over it, no separate voice: every
	// caption belongs to the piece under it, and its speech runs through all the pieces.
	const talk = (pieces: number, captions: number) => {
		const main = Array.from({ length: pieces }, (_, i) => ({ id: `p${i}`, type: "video", name: "talk", mediaId: "talk", startTime: i * 300, duration: 300, trimStart: i * 300, trimEnd: 0, params: {} }));
		const texts = Array.from({ length: captions }, (_, i) => ({ id: `w${i}`, type: "text", name: `w${i}`, startTime: Math.floor((i * pieces * 300) / captions) + 7, duration: 120, params: { "caption.style": "caption" } }));
		return { main: { id: "main", type: "video", name: "Main", elements: main }, overlay: [{ id: "captions", type: "text", name: "Captions", elements: texts }], audio: [] } as unknown as SceneTracks;
	};
	test("400 pieces under 500 captions, the first piece trimmed: the same answer, far sooner", () => {
		const before = talk(400, 500);
		// the head of the first piece trimmed by 100 with the magnet on: everything after it comes 100 sooner
		const after = {
			...before,
			main: { ...before.main, elements: (before.main.elements as unknown as El[]).map((clip, i) => (i === 0 ? { ...clip, duration: 200, trimStart: 100 } : { ...clip, startTime: clip.startTime - 100 })) },
		} as unknown as SceneTracks;
		const kinds = new Set<LinkageKind>(ALL_KINDS);
		const t0 = performance.now();
		const expected = applyLinkageReference({ before, after, kinds });
		const t1 = performance.now();
		const got = applyLinkage({ before, after, kinds });
		const t2 = performance.now();
		expect(JSON.stringify(got)).toBe(JSON.stringify(expected));
		// 500 captions moved with their speech
		expect((got.overlay[0].elements as unknown as El[]).filter((caption, i) => caption.startTime !== (before.overlay[0].elements as unknown as El[])[i]?.startTime).length).toBeGreaterThan(450);
		console.log(`linkage of one trim, 400 pieces × 500 captions: was ${(t1 - t0).toFixed(0)} ms, is ${(t2 - t1).toFixed(1)} ms`);
		expect(t2 - t1).toBeLessThan((t1 - t0) / 10);
	});
});

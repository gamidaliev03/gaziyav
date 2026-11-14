import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import { DUB_DUCK_DB, dubPlacement, placeWords } from "@/assist/dub-timing";

// Dub modes on a real editor: "Voice only" puts the new voice on an audio track with the original speech's timing and
// leaves the picture alone (original muted, or ducked when "Replace" is off); "Voice + lipsync" swaps the clip's
// picture for the lipsynced one. Each is one ⌘Z.
let core: typeof import("@/core");
let bridge: typeof import("@/studio/client/editor-bridge");
let wasm: typeof import("@/wasm");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	bridge = await import("@/studio/client/editor-bridge");
	wasm = await import("@/wasm");
});
// The editor is a singleton: leave it fresh for the next test file.
afterAll(() => core.EditorCore.reset());

async function project() {
	const { EditorCore } = core;
	const { buildDefaultScene } = await import("@/timeline/scenes");
	const { buildElementFromMedia } = await import("@/timeline/element-utils");
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const scene = buildDefaultScene({ name: "Main", isMain: true });
	editor.project.setActiveProject({
		project: {
			metadata: { id: "p", name: "p", createdAt: new Date(0), updatedAt: new Date(0) },
			scenes: [scene],
			currentSceneId: scene.id,
			settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 } },
			version: 31,
		} as never,
	});
	editor.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
	// A 10 s talking clip on the main track.
	editor.timeline.insertElement({
		element: buildElementFromMedia({ mediaId: "talk", mediaType: "video", name: "talk.mp4", duration: wasm.mediaTimeFromSeconds({ seconds: 10 }), startTime: wasm.mediaTimeFromSeconds({ seconds: 2 }) }),
		placement: { mode: "auto" },
	});
	const tracks = () => editor.scenes.getActiveScene().tracks;
	const v = tracks().main.elements[0] as import("@/timeline").VideoElement;
	const clip = {
		trackId: tracks().main.id,
		elementId: v.id,
		element: v,
		asset: { id: "talk", name: "talk.mp4", type: "video", duration: 10 } as never,
		start: 0,
		length: 10,
		// The main track is magnetic: the clip sits where the editor put it.
		at: wasm.mediaTimeToSeconds({ time: v.startTime }),
	};
	return { editor, tracks, clip };
}

const sec = (t: number) => wasm.mediaTimeToSeconds({ time: t as never });
const voice = (seconds: number) => ({ id: "voice", name: "Voice · talk.mp3", type: "audio", duration: seconds }) as never;

describe("dub: Voice only", () => {
	test("timing: the voice starts where the person starts talking and is fitted to how long they talk", () => {
		// Speech 3.0–7.0 s on the timeline (4 s); the translation is 4.6 s → played at 1.15×.
		const p = dubPlacement({ clipAt: 2, voiceSeconds: 4.6, timing: { at: 3, span: 4 } });
		expect(p.start).toBe(3);
		expect(p.rate).toBeCloseTo(1.15, 5);
		expect(p.duration).toBeCloseTo(4, 5);
		// Far longer than the original: fitted only up to 1.25×, then it just runs longer.
		expect(dubPlacement({ clipAt: 2, voiceSeconds: 8, timing: { at: 3, span: 4 } }).rate).toBe(1.25);
		// Nearly the same length: untouched.
		expect(dubPlacement({ clipAt: 2, voiceSeconds: 4.05, timing: { at: 3, span: 4 } }).rate).toBe(1);
		// No dub timing (a plain voice-over): at the clip start, as before.
		expect(dubPlacement({ clipAt: 2, voiceSeconds: 5 })).toEqual({ start: 2, rate: 1, duration: 5 });
		expect(placeWords([{ start: 1.15, end: 2.3 }], 1.15)[0].start).toBeCloseTo(1, 5);
	});

	test("replace: a new audio track with the original timing, the clip muted, the picture untouched; one ⌘Z", async () => {
		const { editor, tracks, clip } = await project();
		const place = { ...dubPlacement({ clipAt: 2, voiceSeconds: 4.6, timing: { at: 3, span: 4 } }), at: 3 };
		bridge.placeVoiceUnder(editor, voice(4.6), clip, true, undefined, place);
		const audio = tracks().audio.flatMap((t) => t.elements);
		expect(audio).toHaveLength(1);
		const a = audio[0] as import("@/timeline").AudioElement & { sourceDuration?: number };
		expect(sec(a.startTime)).toBeCloseTo(3, 3);
		expect(sec(a.duration)).toBeCloseTo(4, 2);
		expect(a.retime?.rate).toBeCloseTo(1.15, 5);
		expect(a.retime?.maintainPitch).toBe(true);
		const v = tracks().main.elements[0];
		expect(v.id).toBe(clip.elementId);
		expect((v as { mediaId: string }).mediaId).toBe("talk");
		expect(v.params?.muted).toBe(true);
		editor.command.undo();
		expect(tracks().audio.flatMap((t) => t.elements)).toHaveLength(0);
		expect(tracks().main.elements[0].params?.muted).not.toBe(true);
	});

	test("replace off: the original speech plays quieter under the new voice", async () => {
		const { editor, tracks, clip } = await project();
		const place = { ...dubPlacement({ clipAt: 2, voiceSeconds: 4, timing: { at: 3, span: 4 } }), at: 3 };
		bridge.placeVoiceUnder(editor, voice(4), clip, false, undefined, place);
		const v = tracks().main.elements[0];
		expect(v.params?.muted).not.toBe(true);
		expect(Number(v.params?.volume)).toBe(DUB_DUCK_DB);
		expect(tracks().audio.flatMap((t) => t.elements)).toHaveLength(1);
	});
});

describe("dub: Voice only again", () => {
	test("the new voice replaces the earlier one under the clip (ducked once); ⌘Z brings the earlier one back, and the next replaces that", async () => {
		const { editor, tracks, clip } = await project();
		const place = { ...dubPlacement({ clipAt: 2, voiceSeconds: 4, timing: { at: 3, span: 4 } }), at: 3 };
		const now = () => ({ ...clip, element: tracks().main.elements[0] as import("@/timeline").VideoElement });
		const audio = () => tracks().audio.flatMap((t) => t.elements.map((e) => e.id));
		const first = bridge.placeVoiceUnder(editor, voice(4), clip, false, undefined, place);
		expect(first.elements).toHaveLength(1);
		const second = bridge.placeVoiceUnder(editor, voice(4), now(), false, undefined, place, [first]);
		expect(audio()).toEqual([second.elements[0].elementId]);
		expect(Number(tracks().main.elements[0].params?.volume)).toBe(DUB_DUCK_DB);
		editor.command.undo();
		expect(audio()).toEqual([first.elements[0].elementId]);
		bridge.placeVoiceUnder(editor, voice(4), now(), true, undefined, place, [first, second]);
		expect(audio()).toHaveLength(1);
		expect(audio()[0]).not.toBe(first.elements[0].elementId);
		expect(tracks().main.elements[0].params?.muted).toBe(true);
		// Another clip's voice is never touched.
		expect(bridge.placeVoiceUnder(editor, voice(4), now(), true, undefined, place, [{ ...first, clipId: "other" }]).elements).toHaveLength(1);
		expect(audio()).toHaveLength(2);
	});
});

describe("dub: Lipsync after Voice only", () => {
	test("the lipsynced clip replaces the clip and the voice-only dub under it, with the clip's own sound; one ⌘Z brings both back", async () => {
		const { editor, tracks, clip } = await project();
		const place = { ...dubPlacement({ clipAt: 2, voiceSeconds: 4, timing: { at: 3, span: 4 } }), at: 3 };
		const placed = bridge.placeVoiceUnder(editor, voice(4), clip, false, undefined, place);
		const now = { ...clip, element: tracks().main.elements[0] as import("@/timeline").VideoElement };
		expect(Number(now.element.params?.volume)).toBe(DUB_DUCK_DB);
		const under = bridge.voicesUnder(editor, clip.elementId, [placed]);
		expect(under.elements).toHaveLength(1);
		bridge.replaceClip(editor, now, { id: "lip", name: "Lipsync · talk.mp4", type: "video", duration: 10 } as never, undefined, false, under);
		expect(tracks().audio.flatMap((t) => t.elements)).toHaveLength(0);
		const v = tracks().main.elements[0];
		expect((v as { mediaId: string }).mediaId).toBe("lip");
		expect(v.params?.muted).toBe(false);
		expect(Number(v.params?.volume ?? 0)).toBe(0);
		editor.command.undo();
		expect(tracks().audio.flatMap((t) => t.elements)).toHaveLength(1);
		expect((tracks().main.elements[0] as { mediaId: string }).mediaId).toBe("talk");
	});
});

describe("dub: Voice + lipsync", () => {
	test("the clip's picture becomes the lipsynced result at the same place; one ⌘Z brings the original back", async () => {
		const { editor, tracks, clip } = await project();
		const result = { id: "lip", name: "Lipsync · talk.mp4", type: "video", duration: 10 } as never;
		bridge.replaceClip(editor, clip, result);
		const main = tracks().main.elements;
		expect(main).toHaveLength(1);
		expect((main[0] as { mediaId: string }).mediaId).toBe("lip");
		expect(sec(main[0].startTime)).toBeCloseTo(clip.at, 3);
		expect(tracks().audio.flatMap((t) => t.elements)).toHaveLength(0);
		editor.command.undo();
		expect((tracks().main.elements[0] as { mediaId: string }).mediaId).toBe("talk");
	});
});

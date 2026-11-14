import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "./wasm-setup";

// Modules that (transitively) import opencut-wasm are loaded after the wasm
// shim is installed.
type Core = typeof import("@/core");
type Elements = typeof import("@/timeline/element-utils");
type Cmds = typeof import("@/commands/timeline");
type BatchMod = typeof import("@/commands");
type IdMod = typeof import("@/utils/id");
type Wasm = typeof import("@/wasm");

let core: Core;
let elements: Elements;
let cmds: Cmds;
let batch: BatchMod;
let ids: IdMod;
let wasm: Wasm;

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	elements = await import("@/timeline/element-utils");
	cmds = await import("@/commands/timeline");
	batch = await import("@/commands");
	ids = await import("@/utils/id");
	wasm = await import("@/wasm");
});

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function setupEditor() {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const { buildDefaultScene } = require("@/timeline/scenes") as typeof import(
		"@/timeline/scenes"
	);
	const scene = buildDefaultScene({ name: "Main", isMain: true });
	editor.project.setActiveProject({
		project: {
			metadata: {
				id: "fuzz-project",
				name: "Fuzz",
				createdAt: new Date(0),
				updatedAt: new Date(0),
			},
			scenes: [scene],
			currentSceneId: scene.id,
			settings: {
				fps: { numerator: 30, denominator: 1 },
				canvasSize: { width: 1080, height: 1920 },
				background: { type: "color", color: "#000000" },
			},
			version: 1,
		} as unknown as import("@/project/types").TProject,
	});
	editor.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
	return editor;
}

type Ref = { trackId: string; elementId: string };

function snapshot(editor: ReturnType<typeof setupEditor>): string {
	return JSON.stringify(editor.scenes.getActiveScene().tracks);
}

function historyLength(editor: ReturnType<typeof setupEditor>): number {
	return (editor.command as unknown as { history: unknown[] }).history.length;
}

function runFuzz({
	seed,
	operations,
	ripple,
}: {
	seed: number;
	operations: number;
	ripple: boolean;
}) {
	const editor = setupEditor();
	editor.command.isRippleEnabled = ripple;
	const random = mulberry32(seed);
	const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
	const { mediaTime, TICKS_PER_SECOND } = wasm;
	const sec = (s: number) => mediaTime({ ticks: Math.round(s * TICKS_PER_SECOND) });

	const allTracks = () => {
		const tracks = editor.scenes.getActiveScene().tracks;
		return [...tracks.overlay, tracks.main, ...tracks.audio];
	};
	const allRefs = (): Array<Ref & { trackType: string }> =>
		allTracks().flatMap((track) =>
			track.elements.map((element) => ({
				trackId: track.id,
				elementId: element.id,
				trackType: track.type,
			})),
		);
	const findElement = (ref: Ref) =>
		allTracks()
			.find((track) => track.id === ref.trackId)
			?.elements.find((element) => element.id === ref.elementId);

	const counts: Record<string, number> = {};
	const states: string[] = [snapshot(editor)];

	const verifyUndoRedo = (depth: number) => {
		const len = historyLength(editor);
		expect(states.length).toBe(len + 1);
		for (let step = 1; step <= depth; step++) {
			editor.command.undo();
			expect(snapshot(editor)).toBe(states[len - step]);
		}
		for (let step = depth - 1; step >= 0; step--) {
			editor.command.redo();
			expect(snapshot(editor)).toBe(states[len - step]);
		}
	};

	const doOperation = (index: number) => {
		const refs = allRefs();
		const roll = random();
		let kind: string;
		if (refs.length < 3 || roll < 0.14) {
			kind = random() < 0.5 ? "insertText" : "insertVideo";
		} else if (roll < 0.34) {
			kind = "split";
		} else if (roll < 0.44) {
			kind = "duplicate";
		} else if (roll < 0.54) {
			kind = "paste";
		} else if (roll < 0.7) {
			kind = "move";
		} else if (roll < 0.78) {
			kind = "delete";
		} else if (roll < 0.88) {
			kind = "update";
		} else if (roll < 0.93) {
			kind = "track";
		} else {
			kind = "batch";
		}
		counts[kind] = (counts[kind] ?? 0) + 1;

		switch (kind) {
			case "insertText": {
				editor.timeline.insertElement({
					element: elements.buildTextElement({
						raw: { name: `T${index}`, duration: sec(1 + random() * 4) },
						startTime: sec(random() * 20),
					}),
					placement: { mode: "auto" },
				});
				return;
			}
			case "insertVideo": {
				editor.timeline.insertElement({
					element: elements.buildElementFromMedia({
						mediaId: "media-1",
						mediaType: random() < 0.7 ? "video" : "audio",
						name: `V${index}`,
						duration: sec(2 + random() * 6),
						startTime: sec(random() * 20),
					}),
					placement: { mode: "auto" },
				});
				return;
			}
			case "split": {
				const target = pick(refs);
				const element = findElement(target);
				if (!element) return;
				const at = Math.round(element.startTime + element.duration * (0.1 + random() * 0.8));
				// Sometimes split everything under the playhead, like ⌘B on a selection.
				const targets =
					random() < 0.3
						? refs.filter((ref) => {
								const candidate = findElement(ref);
								return (
									candidate &&
									candidate.startTime < at &&
									candidate.startTime + candidate.duration > at
								);
							})
						: [target];
				editor.timeline.splitElements({
					elements: targets,
					splitTime: mediaTime({ ticks: at }),
					retainSide: pick(["both", "both", "both", "left", "right"] as const),
				});
				return;
			}
			case "duplicate": {
				const targets = [pick(refs), ...(random() < 0.3 ? [pick(refs)] : [])];
				editor.command.execute({
					command: new cmds.DuplicateElementsCommand({ elements: targets }),
				});
				return;
			}
			case "paste": {
				const targets = [pick(refs), ...(random() < 0.3 ? [pick(refs)] : [])];
				const items = targets.flatMap((ref) => {
					const element = findElement(ref);
					if (!element) return [];
					const { id: _id, ...rest } = element;
					return [
						{
							trackId: ref.trackId,
							trackType: (ref as { trackType: string }).trackType,
							element: rest,
						},
					];
				});
				editor.command.execute({
					command: new cmds.PasteCommand({
						time: sec(random() * 30),
						clipboardItems: items as never,
					}),
				});
				return;
			}
			case "move": {
				const target = pick(refs);
				const element = findElement(target);
				if (!element) return;
				const sourceTrack = allTracks().find((t) => t.id === target.trackId);
				const compatible = allTracks().filter((t) => t.type === sourceTrack?.type);
				const toNewTrack = random() < 0.25 && sourceTrack?.type !== "video";
				const newTrackId = ids.generateUUID();
				const targetTrackId = toNewTrack ? newTrackId : pick(compatible).id;
				editor.timeline.moveElements({
					moves: [
						{
							sourceTrackId: target.trackId,
							targetTrackId,
							elementId: target.elementId,
							newStartTime: sec(random() * 25),
						},
					],
					createTracks: toNewTrack
						? [{ id: newTrackId, type: sourceTrack?.type ?? "text", index: 0 }]
						: [],
				});
				return;
			}
			case "delete": {
				editor.timeline.deleteElements({ elements: [pick(refs)] });
				return;
			}
			case "update": {
				const target = pick(refs);
				editor.timeline.updateElements({
					updates: [
						{
							...target,
							patch: { name: `renamed-${index}` },
						},
					],
				});
				return;
			}
			case "track": {
				const target = pick(refs);
				if (random() < 0.5) {
					editor.timeline.toggleTrackVisibility({ trackId: target.trackId });
				} else {
					editor.timeline.addTrack({ type: pick(["text", "audio", "video"] as const) });
				}
				return;
			}
			case "batch": {
				// One ⌘Z for split + duplicate + rename, like AI/macro edits.
				const target = pick(refs);
				const element = findElement(target);
				if (!element) return;
				const at = Math.round(element.startTime + element.duration / 2);
				editor.command.execute({
					command: new batch.BatchCommand([
						new cmds.SplitElementsCommand({
							elements: [target],
							splitTime: mediaTime({ ticks: at }),
						}),
						new cmds.DuplicateElementsCommand({ elements: [target] }),
						new cmds.UpdateElementsCommand({
							updates: [{ ...target, patch: { name: `batch-${index}` } }],
						}),
					]),
				});
				return;
			}
		}
	};

	for (let index = 0; index < operations; index++) {
		const before = historyLength(editor);
		// Occasionally branch: undo a few steps, then do a new edit.
		if (random() < 0.05 && before > 3) {
			const depth = 1 + Math.floor(random() * 3);
			for (let step = 0; step < depth; step++) editor.command.undo();
			states.length -= depth;
			expect(snapshot(editor)).toBe(states[states.length - 1]);
		}
		const lengthBefore = historyLength(editor);
		doOperation(index);
		if (historyLength(editor) > lengthBefore) {
			states.push(snapshot(editor));
		} else {
			expect(snapshot(editor)).toBe(states[states.length - 1]);
		}
		if (random() < 0.15) {
			verifyUndoRedo(Math.min(historyLength(editor), 1 + Math.floor(random() * 12)));
		}
	}

	// Full rewind and full replay must walk through the exact same states.
	const total = historyLength(editor);
	verifyUndoRedo(total);
	for (let step = 0; step < total; step++) editor.command.undo();
	expect(snapshot(editor)).toBe(states[0]);
	expect(editor.command.canUndo()).toBe(false);
	for (let step = 1; step <= total; step++) {
		editor.command.redo();
		expect(snapshot(editor)).toBe(states[step]);
	}
	return { counts, total, elementCount: allRefs().length };
}

describe("undo/redo fuzz", () => {
	test("500 random edits: undo/redo walks identical states", () => {
		const result = runFuzz({ seed: 20261021, operations: 500, ripple: false });
		expect(result.total).toBeGreaterThan(400);
		console.log("[fuzz]", JSON.stringify(result));
	});

	test("500 random edits with ripple editing", () => {
		const result = runFuzz({ seed: 7, operations: 500, ripple: true });
		expect(result.total).toBeGreaterThan(400);
		console.log("[fuzz ripple]", JSON.stringify(result));
	});

	test("M7: split, move the right half, undo both, redo both", () => {
		const editor = setupEditor();
		const { mediaTime, TICKS_PER_SECOND } = wasm;
		editor.timeline.insertElement({
			element: elements.buildTextElement({
				raw: { name: "clip", duration: mediaTime({ ticks: 4 * TICKS_PER_SECOND }) },
				startTime: mediaTime({ ticks: 0 }),
			}),
			placement: { mode: "auto" },
		});
		const tracks = editor.scenes.getActiveScene().tracks;
		const track = tracks.overlay[0];
		const [right] = editor.timeline.splitElements({
			elements: [{ trackId: track.id, elementId: track.elements[0].id }],
			splitTime: mediaTime({ ticks: 2 * TICKS_PER_SECOND }),
		});
		editor.timeline.moveElements({
			moves: [
				{
					sourceTrackId: right.trackId,
					targetTrackId: right.trackId,
					elementId: right.elementId,
					newStartTime: mediaTime({ ticks: 6 * TICKS_PER_SECOND }),
				},
			],
		});
		const after = snapshot(editor);
		editor.command.undo();
		editor.command.undo();
		editor.command.redo();
		editor.command.redo();
		expect(snapshot(editor)).toBe(after);
	});

	test("a failing redo rolls back instead of corrupting the timeline", () => {
		const editor = setupEditor();
		const failures: string[] = [];
		editor.command.onHistoryFailure(({ kind }) => failures.push(kind));
		const { Command } = require("@/commands/base-command") as typeof import(
			"@/commands/base-command"
		);
		class Exploding extends Command {
			private runs = 0;
			execute() {
				this.runs += 1;
				if (this.runs > 1) {
					editor.timeline.updateTracks({
						...editor.scenes.getActiveScene().tracks,
						overlay: [],
					});
					throw new Error("boom");
				}
				return undefined;
			}
			undo() {}
		}
		editor.command.execute({ command: new Exploding() });
		const before = snapshot(editor);
		editor.command.undo();
		editor.command.redo();
		expect(failures).toEqual(["redo"]);
		expect(snapshot(editor)).toBe(before);
		expect(editor.command.canRedo()).toBe(false);
	});
});


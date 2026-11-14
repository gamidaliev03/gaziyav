import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// K1: CapCut's default keymap 1:1 (docs/capcut/keymap-default.json, Qt notation: Ctrl = ⌘, Alt = ⌥, Meta = ⌃), the
// Premiere preset (keymap-premiere.json), the old keymap kept as «Legacy», and the CapCut commands Gaziyav lacked.
let presets: typeof import("@/actions/keybindings/presets");
let migrations: typeof import("@/actions/keybindings/migrations");
let keybinding: typeof import("@/actions/keybinding");
let commands: typeof import("@/actions/capcut-commands");
let core: typeof import("@/core");
let elements: typeof import("@/timeline/element-utils");
let wasm: typeof import("@/wasm");

beforeAll(async () => {
	await installOpenCutWasm();
	presets = await import("@/actions/keybindings/presets");
	migrations = await import("@/actions/keybindings/migrations");
	keybinding = await import("@/actions/keybinding");
	commands = await import("@/actions/capcut-commands");
	core = await import("@/core");
	elements = await import("@/timeline/element-utils");
	wasm = await import("@/wasm");
});

/** CapCut 9.5 default preset (keymap-default.json), keyboard rows only; CJK duplicates (【 】 · ， 。 ；) left out. */
const CAPCUT_DEFAULT: Record<string, string[]> = {
	activeSpeedControl: ["Ctrl+R"],
	addBasicKeyframe: ["Shift+Alt+K"],
	adsorb: ["N"],
	agentVoiceInput: ["Ctrl+D"],
	backwardSelect: ["]"],
	batchCut: ["Ctrl+Shift+B"],
	cancelRangeSelect: ["Alt+X"],
	closeDialog: ["Escape"],
	closeWindow: ["Ctrl+W"],
	copy: ["Ctrl+C"],
	copySegAttribute: ["Ctrl+Shift+C"],
	cut: ["Ctrl+X"],
	cutLeft: ["Q"],
	cutRight: ["W"],
	cutoff: ["Ctrl+B"],
	del: ["Backspace", "Del"],
	divideSpeedSegment: ["Shift+B"],
	expandKeyframePanel: ["Alt+K"],
	exportVideo: ["Ctrl+E"],
	forwardSelect: ["["],
	hidePlayerRuler: ["Ctrl+Alt+R"],
	hideReferenceLine: ["Ctrl+;"],
	importMedia: ["Ctrl+I"],
	largeNextFrame: ["Shift+Right"],
	largePreFrame: ["Shift+Left"],
	linkage: ["`"],
	locateFirstFrame: ["Home"],
	locateLastFrame: ["End"],
	mainTrackAdsorb: ["P"],
	mark: ["M"],
	markBeat: ["Ctrl+J"],
	markWithAnotherColor: ["Alt+M"],
	newProject: ["Ctrl+N"],
	nextCutPoint: ["Down"],
	nextFrame: ["Right"],
	nextTimeMark: ["Shift+M"],
	paste: ["Ctrl+V"],
	pasteSegAttribute: ["Ctrl+Shift+V"],
	playerZoomFit: ["Alt+Shift+Z"],
	playerZoomIn: ["Alt+Shift++", "Alt+Shift+="],
	playerZoomOut: ["Alt+Shift+-"],
	prerenderSelectArea: ["Shift+Return"],
	prevCutPoint: ["Up"],
	prevFrame: ["Left"],
	prevTimeMark: ["Alt+Shift+M"],
	preview: ["S"],
	quicklyAdjustZoomFit: ["Shift+Z"],
	quit: ["Ctrl+Q"],
	redo: ["Ctrl+Shift+Z"],
	returnDraftPage: ["Ctrl+Alt+Q"],
	segmentCombination: ["Alt+G"],
	segmentMakeGroup: ["Ctrl+G"],
	segmentRemoveCombination: ["Alt+Shift+G"],
	segmentRemoveGroup: ["Ctrl+Shift+G"],
	selectAll: ["Ctrl+A"],
	selectRangeBySegment: ["Shift+X"],
	selectRangeEnd: ["O"],
	selectRangeStart: ["I"],
	showFullscreen: ["Ctrl+Meta+F"],
	speedPlayBackward: ["J"],
	speedPlayForward: ["L"],
	speedPlayPause: ["K"],
	subtitleNewLine: ["Ctrl+Return"],
	subtitleSplit: ["Return"],
	switchTab: ["Tab"],
	switchToCut: ["B"],
	switchToSelect: ["A"],
	toggleFullscreen: ["Ctrl+Shift+F"],
	togglePlay: ["Space"],
	toggleSegmentVisibe: ["V"],
	toggleVideoAudio: ["Shift+Meta+S"],
	undo: ["Ctrl+Z"],
	videoRecord: ["Ctrl+Alt+P"],
	voiceDown: ["Ctrl+,"],
	voiceUp: ["Ctrl+."],
	zoomIn: ["Ctrl++", "Ctrl+="],
	zoomOut: ["Ctrl+-"],
};

/** CapCut id → Gaziyav action. */
const CAPCUT_TO_ACTION: Record<string, string> = {
	togglePlay: "toggle-play",
	speedPlayBackward: "shuttle-backward",
	speedPlayPause: "shuttle-stop",
	speedPlayForward: "shuttle-forward",
	prevFrame: "frame-step-backward",
	nextFrame: "frame-step-forward",
	largePreFrame: "frame-step-backward-large",
	largeNextFrame: "frame-step-forward-large",
	prevCutPoint: "previous-edit",
	nextCutPoint: "next-edit",
	locateFirstFrame: "goto-start",
	locateLastFrame: "goto-end",
	toggleFullscreen: "player-fullscreen",
	playerZoomIn: "player-zoom-in",
	playerZoomOut: "player-zoom-out",
	playerZoomFit: "player-zoom-fit",
	hideReferenceLine: "toggle-guides",
	hidePlayerRuler: "toggle-rulers",
	cutoff: "split",
	batchCut: "split-all",
	cutLeft: "split-left",
	cutRight: "split-right",
	del: "delete-selected",
	copy: "copy-selected",
	cut: "cut-selected",
	paste: "paste-copied",
	copySegAttribute: "copy-attributes",
	pasteSegAttribute: "paste-attributes",
	undo: "undo",
	redo: "redo",
	selectAll: "select-all",
	forwardSelect: "select-backward",
	backwardSelect: "select-forward",
	adsorb: "toggle-snapping",
	mainTrackAdsorb: "toggle-ripple-editing",
	switchToSelect: "tool-select",
	switchToCut: "tool-split",
	linkage: "toggle-linkage",
	preview: "toggle-preview-axis",
	zoomIn: "timeline-zoom-in",
	zoomOut: "timeline-zoom-out",
	quicklyAdjustZoomFit: "timeline-zoom-fit",
	toggleSegmentVisibe: "toggle-elements-visibility-selected",
	selectRangeStart: "mark-in",
	selectRangeEnd: "mark-out",
	selectRangeBySegment: "mark-clip",
	cancelRangeSelect: "clear-in-out",
	toggleVideoAudio: "toggle-source-audio",
	segmentMakeGroup: "group-selected",
	segmentRemoveGroup: "ungroup-selected",
	segmentCombination: "create-compound",
	segmentRemoveCombination: "dismiss-compound",
	markBeat: "mark-beat",
	mark: "toggle-bookmark",
	markWithAnotherColor: "add-marker-alt-color",
	prevTimeMark: "previous-marker",
	nextTimeMark: "next-marker",
	activeSpeedControl: "speed-duration",
	expandKeyframePanel: "toggle-keyframe-panel",
	addBasicKeyframe: "toggle-keyframe",
	voiceUp: "volume-up",
	voiceDown: "volume-down",
	newProject: "new-project",
	importMedia: "import-media",
	exportVideo: "export-project",
	closeWindow: "close-project",
	closeDialog: "cancel-interaction",
	returnDraftPage: "show-projects",
	switchTab: "focus-next-panel",
};

/** CapCut commands Gaziyav does not have (yet): their keys must stay free, not do something else. */
const NOT_IN_GAZIYAV = [
	"prerenderSelectArea",
	"divideSpeedSegment",
	"subtitleSplit",
	"subtitleNewLine",
	"agentVoiceInput",
	"videoRecord",
];
/** Handled by the Mac menu (Quit, Enter Full Screen), not by the page. */
const BY_THE_MENU = ["quit", "showFullscreen"];
/** On another key on purpose (regfix 14.11): ⌘, is the Mac's Settings key, so the volume pair is ⌥⌘. / ⌥⌘, . */
const MOVED: Record<string, string> = { voiceUp: "alt+cmd+.", voiceDown: "alt+cmd+," };

const QT_KEYS: Record<string, string> = { "+": "=", Return: "enter", Del: "delete", Escape: "escape", Backspace: "backspace", Space: "space", Tab: "tab", Home: "home", End: "end", Up: "up", Down: "down", Left: "left", Right: "right" };
const QT_MODIFIERS: Record<string, "cmd" | "alt" | "shift" | "ctrl"> = { Ctrl: "cmd", Alt: "alt", Shift: "shift", Meta: "ctrl" };

/** "Ctrl+Shift+B" → "shift+cmd+b"; "Alt+Shift++" → "alt+shift+=". */
function fromQt(sequence: string): string {
	const parts = sequence.endsWith("++") ? [...sequence.slice(0, -2).split("+"), "+"] : sequence.split("+");
	const key = parts.pop() ?? "";
	const name = QT_KEYS[key] ?? key.toLowerCase();
	if (!keybinding.isKey(name)) throw new Error(`no key for ${sequence}`);
	return keybinding.buildShortcut({ modifiers: parts.map((m) => QT_MODIFIERS[m]), key: name });
}

describe("CapCut keymap 1:1", () => {
	test("CapCut is the default preset; Final Cut Pro is the other one", () => {
		expect(presets.DEFAULT_KEYMAP_PRESET).toBe("capcut");
		expect(presets.KEYMAP_PRESET_IDS).toEqual(["capcut", "finalcut"]);
	});

	test("every CapCut key does the same command in Gaziyav", () => {
		const bindings = presets.getPresetBindings({ preset: "capcut" });
		const covered = new Set([...Object.keys(CAPCUT_TO_ACTION), ...NOT_IN_GAZIYAV, ...BY_THE_MENU]);
		expect([...Object.keys(CAPCUT_DEFAULT)].filter((id) => !covered.has(id))).toEqual([]);
		for (const [id, action] of Object.entries(CAPCUT_TO_ACTION)) {
			if (MOVED[id]) {
				expect([id, bindings.get(MOVED[id] as never)]).toEqual([id, action as never]);
				continue;
			}
			for (const sequence of CAPCUT_DEFAULT[id]) expect([id, bindings.get(fromQt(sequence) as never)]).toEqual([id, action as never]);
		}
	});

	test("the keys of CapCut commands Gaziyav lacks stay free (⌘D, Return, ⇧B…)", () => {
		const bindings = presets.getPresetBindings({ preset: "capcut" });
		for (const id of [...NOT_IN_GAZIYAV, ...BY_THE_MENU]) {
			for (const sequence of CAPCUT_DEFAULT[id]) expect([id, bindings.get(fromQt(sequence) as never)]).toEqual([id, undefined]);
		}
	});

	test("saved keymaps: unchanged old default → CapCut; unchanged Final Cut stays; customized keeps its keys and gets the new commands on free keys", () => {
		const run = (state: object) => migrations.runMigrations({ state, fromVersion: 12 }) as { preset: string; keybindings: Record<string, string> };
		expect(run({ keybindings: { s: "toggle-snapping" }, isCustomized: false, preset: "kadr" }).preset).toBe("capcut");
		expect(run({ keybindings: { s: "toggle-snapping" }, isCustomized: false, preset: "finalcut" }).preset).toBe("finalcut");
		const custom = run({ keybindings: { "cmd+.": "split", s: "toggle-snapping" }, isCustomized: true, preset: "kadr" });
		expect(custom.keybindings["cmd+."]).toBe("split");
		expect(custom.keybindings["alt+cmd+,"]).toBe("volume-down");
		expect(custom.keybindings["shift+m"]).toBe("next-marker");
		expect(custom.keybindings.s).toBe("toggle-snapping");
		expect(custom.preset).toBe("capcut");
		// a keymap of a removed preset (Premiere Pro) that nobody changed becomes CapCut's
		expect(run({ keybindings: { "cmd+k": "split" }, isCustomized: false, preset: "premiere" }).keybindings["cmd+b"]).toBe("split");
	});
});

describe("CapCut commands Gaziyav lacked", () => {
	const sec = (s: number) => wasm.mediaTime({ ticks: Math.round(s * wasm.TICKS_PER_SECOND) });

	function setup() {
		const { EditorCore } = core;
		EditorCore.reset();
		const editor = EditorCore.getInstance();
		editor.save.stop();
		const { buildDefaultScene } = require("@/timeline/scenes") as typeof import("@/timeline/scenes");
		const scene = buildDefaultScene({ name: "Main", isMain: true });
		editor.project.setActiveProject({
			project: {
				metadata: { id: "k1", name: "K1", createdAt: new Date(0), updatedAt: new Date(0) },
				scenes: [scene],
				currentSceneId: scene.id,
				settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 }, background: { type: "color", color: "#000000" } },
				version: 1,
			} as unknown as import("@/project/types").TProject,
		});
		editor.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
		const built = elements.buildElementFromMedia({ mediaId: "m", mediaType: "video", name: "A", duration: sec(10), startTime: sec(0) });
		const trackId = editor.scenes.getActiveScene().tracks.main.id;
		editor.timeline.insertElement({ element: { ...built, sourceDuration: sec(10) } as never, placement: { mode: "explicit", trackId } as never });
		const element = () => editor.scenes.getActiveScene().tracks.main.elements[0];
		editor.selection.setSelectedElements({ elements: [{ trackId, elementId: element().id }] });
		return { editor, element };
	}

	test("⇧M / ⌥⇧M jump to the next / previous marker; none → stays", () => {
		const { editor } = setup();
		for (const s of [2, 5, 8]) {
			editor.playback.seek({ time: sec(s) });
			editor.scenes.toggleBookmark({ time: sec(s) });
		}
		editor.playback.seek({ time: sec(3) });
		expect(commands.jumpToMarker(editor, "next")).toBe(sec(5));
		expect(commands.jumpToMarker(editor, "next")).toBe(sec(8));
		expect(commands.jumpToMarker(editor, "next")).toBeNull();
		expect(editor.playback.getCurrentTime()).toBe(sec(8));
		expect(commands.jumpToMarker(editor, "previous")).toBe(sec(5));
	});

	test("⌥M puts a marker in the other color in one ⌘Z; on a marker it flips the color", () => {
		const { editor } = setup();
		editor.playback.seek({ time: sec(4) });
		commands.addMarkerInAnotherColor(editor);
		const marker = () => editor.scenes.getActiveScene().bookmarks.find((b) => b.time === sec(4));
		expect(marker()?.color).toBe(commands.ALT_MARKER_COLOR);
		commands.addMarkerInAnotherColor(editor);
		expect(marker()?.color).not.toBe(commands.ALT_MARKER_COLOR);
		editor.command.undo();
		editor.command.undo();
		expect(marker()).toBeUndefined();
	});

	test("⌘. / ⌘, change the selected clip's volume by 1 dB, within its range, one ⌘Z each", () => {
		const { editor, element } = setup();
		const volume = () => Number(element().params.volume ?? 0);
		expect(commands.changeSelectedVolume(editor, 1)).toBe(1);
		expect(volume()).toBe(1);
		commands.changeSelectedVolume(editor, -1);
		commands.changeSelectedVolume(editor, -1);
		expect(volume()).toBe(-1);
		editor.command.undo();
		expect(volume()).toBe(0);
		editor.timeline.updateElements({ updates: [{ trackId: editor.scenes.getActiveScene().tracks.main.id, elementId: element().id, patch: { params: { ...element().params, volume: 20 } } as never }] });
		expect(commands.changeSelectedVolume(editor, 1)).toBe(0);
		editor.selection.setSelectedElements({ elements: [] });
		expect(commands.changeSelectedVolume(editor, 1)).toBe(0);
	});

	test("⌥K opens and closes the keyframe lanes of the selected clip", async () => {
		const { editor, element } = setup();
		const { useTimelineStore } = await import("@/timeline/timeline-store");
		expect(commands.toggleKeyframePanel(editor)).toBe(1);
		expect(useTimelineStore.getState().expandedElementIds.has(element().id)).toBe(true);
		commands.toggleKeyframePanel(editor);
		expect(useTimelineStore.getState().expandedElementIds.has(element().id)).toBe(false);
	});

	test("⌘; turns the player's guides off and back on (the last one); ⌥⌘R the rulers", async () => {
		const { usePreviewStore } = await import("@/preview/preview-store");
		usePreviewStore.setState({ activeGuide: null, overlays: {} });
		commands.toggleGuides();
		expect(usePreviewStore.getState().activeGuide).toBe("grid");
		usePreviewStore.getState().toggleGuide("tiktok" as never);
		commands.toggleGuides();
		expect(usePreviewStore.getState().activeGuide).toBeNull();
		commands.toggleGuides();
		expect(usePreviewStore.getState().activeGuide).toBe("tiktok");
		commands.toggleRulers();
		expect(usePreviewStore.getState().overlays[commands.RULERS_OVERLAY_ID]).toBe(true);
		commands.toggleRulers();
		expect(usePreviewStore.getState().overlays[commands.RULERS_OVERLAY_ID]).toBe(false);
	});
});

describe("⌘S", () => {
	test("saves the project in both keymaps; a customized keymap gets it on a free key", () => {
		expect(presets.getPresetBindings({ preset: "capcut" }).get("cmd+s" as never)).toBe("save-project" as never);
		expect(presets.getPresetBindings({ preset: "finalcut" }).get("cmd+s" as never)).toBe("save-project" as never);
		const run = (state: object) => migrations.runMigrations({ state, fromVersion: 15 }) as { keybindings: Record<string, string> };
		expect(run({ keybindings: { "cmd+z": "undo" }, isCustomized: true, preset: "capcut" }).keybindings["cmd+s"]).toBe("save-project");
		expect(run({ keybindings: { "cmd+s": "split" }, isCustomized: true, preset: "capcut" }).keybindings["cmd+s"]).toBe("split");
	});
});

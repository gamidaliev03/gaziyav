"use client";

/**
 * K3: presses every key of the active keymap in the running editor and checks what it did (dev builds only:
 * `await window.__gaziyavKeyCheck()` in the editor, or a CDP script). Each key goes through the real global listener
 * as a keydown on the document; a spy on the action registry confirms the key reached its command, and a check per
 * command looks at the project afterwards (clips, selection, playhead, markers, In/Out, volume, keyframes, stores).
 * The project is put back as it was at the end.
 *
 * Not pressed, only resolved key → command: commands that leave the editor or open a system window (new project,
 * close, all projects, import) and the player's full screen (the browser wants a real key press for it).
 */
import { bindAction, unbindAction } from "@/actions/registry";
import type { TActionWithOptionalArgs } from "@/actions/types";
import { parseShortcut, type ShortcutKey } from "@/actions/keybinding";
import { useKeybindingsStore } from "@/actions/keybindings-store";
import { getElementKeyframes } from "@/animation/keyframe-query";
import { useShellStore } from "@/components/editor/shell-store";
import { EditorCore } from "@/core";
import { useInOutStore } from "@/in-out/store";
import { usePreviewStore } from "@/preview/preview-store";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { useTimelineStore } from "@/timeline/timeline-store";
import type { TimelineElement, TScene, VideoElement } from "@/timeline/types";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";

export interface KeyCheckRow {
	key: ShortcutKey;
	action: TActionWithOptionalArgs;
	pressed: boolean;
	fired: boolean;
	ok: boolean;
	detail: string;
}

const NOT_PRESSED: ReadonlySet<string> = new Set(["new-project", "close-project", "show-projects", "import-media", "import-link", "player-fullscreen"]);

const KEY_TO_CODE: Record<string, string> = {
	",": "Comma", ".": "Period", "/": "Slash", ";": "Semicolon", "'": "Quote", "[": "BracketLeft", "]": "BracketRight",
	"\\": "Backslash", "=": "Equal", "-": "Minus", "`": "Backquote", space: "Space", enter: "Enter", tab: "Tab",
	escape: "Escape", backspace: "Backspace", delete: "Delete", home: "Home", end: "End", pageup: "PageUp",
	pagedown: "PageDown", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
};
const KEY_TO_NAME: Record<string, string> = { space: " ", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", escape: "Escape", backspace: "Backspace", delete: "Delete", enter: "Enter", tab: "Tab", home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown" };

function keydown(key: ShortcutKey): KeyboardEvent {
	const parsed = parseShortcut(key);
	if (!parsed) throw new Error(`bad shortcut ${key}`);
	const name = parsed.key;
	const code = KEY_TO_CODE[name] ?? (/^[a-z]$/.test(name) ? `Key${name.toUpperCase()}` : /^[0-9]$/.test(name) ? `Digit${name}` : name.toUpperCase());
	const mac = navigator.platform.toLowerCase().includes("mac") || /Mac/.test(navigator.userAgent);
	return new KeyboardEvent("keydown", {
		key: KEY_TO_NAME[name] ?? name,
		code,
		metaKey: mac && parsed.modifiers.includes("cmd"),
		ctrlKey: parsed.modifiers.includes("ctrl") || (!mac && parsed.modifiers.includes("cmd")),
		altKey: parsed.modifiers.includes("alt"),
		shiftKey: parsed.modifiers.includes("shift"),
		bubbles: true,
		cancelable: true,
	});
}

// Timers, not animation frames: the check also runs while the window is in the background (frames stop there).
const frames = (n = 2) => new Promise<void>((resolve) => setTimeout(resolve, 20 * n));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Whether the page gets animation frames (a hidden or covered window gets none, and the shuttle moves on them). */
let framesRunning = true;
const probeFrames = () =>
	new Promise<boolean>((resolve) => {
		const timer = setTimeout(() => resolve(false), 200);
		requestAnimationFrame(() => {
			clearTimeout(timer);
			resolve(true);
		});
	});

/** The test project: clips A 0–3 s, B 3–6 s, C 6–9 s on the main track, opacity keys on B, markers at 1 s and 7 s. */
function fixture(editor: EditorCore) {
	const sec = (s: number) => mediaTime({ ticks: Math.round(s * TICKS_PER_SECOND) });
	const original = editor.scenes.getScenes();
	const active = editor.scenes.getActiveScene();
	const clip = (name: string, start: number): VideoElement => {
		const built = buildElementFromMedia({ mediaId: `key-check-${name}`, mediaType: "video", name, duration: sec(3), startTime: sec(start) });
		return { ...built, id: `key-check-${name}`, sourceDuration: sec(30), trimStart: sec(5), trimEnd: sec(22) } as VideoElement;
	};
	const reset = () => {
		const b = clip("B", 3);
		const keyed = {
			...b,
			animations: { opacity: { keys: [0, 1.5].map((s, i) => ({ id: `key-check-k${i}`, time: sec(s), value: 1 - i * 0.5, segmentToNext: "linear" as const, tangentMode: "flat" as const })) } },
		} as VideoElement;
		const scene: TScene = {
			...active,
			tracks: { ...active.tracks, overlay: [], audio: [], main: { ...active.tracks.main, elements: [clip("A", 0), keyed, clip("C", 6)] } },
			bookmarks: [{ time: sec(1) }, { time: sec(7) }],
		};
		editor.scenes.setScenes({ scenes: original.map((s) => (s.id === active.id ? scene : s)), activeSceneId: active.id });
		editor.playback.pause();
		editor.playback.seek({ time: sec(4.5) });
		editor.selection.clearKeyframeSelection();
		editor.selection.setSelectedElements({ elements: [{ trackId: active.tracks.main.id, elementId: "key-check-B" }] });
		useInOutStore.getState().clear();
		// The keyframe lanes of the test clips start closed (a previous run may have left B open).
		const expanded = new Set([...useTimelineStore.getState().expandedElementIds].filter((id) => !id.startsWith("key-check-")));
		useTimelineStore.setState({ expandedElementIds: expanded });
		useShellStore.getState().setExportOpen(false);
		(document.activeElement as HTMLElement | null)?.blur?.();
	};
	const restore = () => editor.scenes.setScenes({ scenes: original, activeSceneId: active.id });
	const clips = () => editor.scenes.getActiveScene().tracks.main.elements;
	/** Clips on every track (a paste may land on a track of its own). */
	const allClips = () => {
		const tracks = editor.scenes.getActiveScene().tracks;
		return [tracks.main, ...tracks.overlay, ...tracks.audio].flatMap((track): TimelineElement[] => [...track.elements]);
	};
	const byName = (name: string) => clips().find((e) => e.name === name);
	const seconds = () => Math.round((editor.playback.getCurrentTime() / TICKS_PER_SECOND) * 1000) / 1000;
	const selected = () => editor.selection.getSelectedElements().map((ref) => ref.elementId).sort();
	return { sec, reset, restore, clips, allClips, byName, seconds, selected, mainTrackId: active.tracks.main.id };
}

type Fixture = ReturnType<typeof fixture>;
type Snapshot = { count: number; seconds: number; selected: string[]; playing: boolean; markers: number; volume: number; keys: number; hiddenB: boolean; durationB: number };
type Check = { setup?: (f: Fixture, editor: EditorCore) => void; expect: (f: Fixture, before: Snapshot, editor: EditorCore) => string | null; settle?: number };

function snapshot(f: Fixture, editor: EditorCore): Snapshot {
	const b = f.byName("B");
	return {
		count: f.clips().length,
		seconds: f.seconds(),
		selected: f.selected(),
		playing: editor.playback.getIsPlaying(),
		markers: editor.scenes.getActiveScene().bookmarks.length,
		volume: Number((b?.params as Record<string, unknown> | undefined)?.volume ?? 0),
		keys: getElementKeyframes({ animations: b?.animations }).length,
		hiddenB: Boolean((b as { hidden?: boolean } | undefined)?.hidden),
		durationB: b ? b.duration / TICKS_PER_SECOND : 0,
	};
}

const FRAME = 1 / 30;
const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
const expectThat = (condition: boolean, message: string) => (condition ? null : message);

/** What each command must have done. Commands not listed here are checked by «it fired» alone. */
const CHECKS: Partial<Record<string, Check>> = {
	"toggle-play": { expect: (_, before, e) => expectThat(e.playback.getIsPlaying() !== before.playing, "play state did not flip") },
	"shuttle-forward": { expect: (_, __, e) => expectThat(e.playback.getIsPlaying(), "not playing") },
	// The shuttle moves on animation frames: a page without frames (hidden or covered) only shows «it fired».
	"shuttle-backward": { settle: 300, expect: (f, before) => (framesRunning ? expectThat(f.seconds() < before.seconds, "playhead did not go back") : null) },
	"shuttle-stop": { setup: (_, e) => e.playback.play(), expect: (_, __, e) => expectThat(!e.playback.getIsPlaying(), "still playing") },
	"frame-step-forward": { expect: (f, b) => expectThat(near(f.seconds() - b.seconds, FRAME), `moved ${f.seconds() - b.seconds}s`) },
	"frame-step-backward": { expect: (f, b) => expectThat(near(b.seconds - f.seconds(), FRAME), `moved ${f.seconds() - b.seconds}s`) },
	"frame-step-forward-large": { expect: (f, b) => expectThat(near(f.seconds() - b.seconds, 10 * FRAME), `moved ${f.seconds() - b.seconds}s`) },
	"frame-step-backward-large": { expect: (f, b) => expectThat(near(b.seconds - f.seconds(), 10 * FRAME), `moved ${f.seconds() - b.seconds}s`) },
	"seek-forward": { expect: (f, b) => expectThat(near(f.seconds() - b.seconds, 1), `moved ${f.seconds() - b.seconds}s`) },
	"seek-backward": { expect: (f, b) => expectThat(near(b.seconds - f.seconds(), 1), `moved ${f.seconds() - b.seconds}s`) },
	"next-edit": { expect: (f) => expectThat(near(f.seconds(), 6), `at ${f.seconds()}s, not the cut at 6s`) },
	"previous-edit": { expect: (f) => expectThat(near(f.seconds(), 3), `at ${f.seconds()}s, not the cut at 3s`) },
	"goto-start": { expect: (f) => expectThat(near(f.seconds(), 0), `at ${f.seconds()}s`) },
	"goto-end": { expect: (f) => expectThat(near(f.seconds(), 9), `at ${f.seconds()}s`) },
	split: { expect: (f, b) => expectThat(f.clips().length === b.count + 1, "no new clip") },
	"split-all": { expect: (f, b) => expectThat(f.clips().length === b.count + 1, "no new clip") },
	"split-left": { expect: (f) => expectThat(near((f.byName("B")?.duration ?? 0) / TICKS_PER_SECOND, 1.5), "B not trimmed to the playhead") },
	"split-right": { expect: (f) => expectThat(near((f.byName("B")?.duration ?? 0) / TICKS_PER_SECOND, 1.5), "B not trimmed from the playhead") },
	"delete-selected": { expect: (f, b) => expectThat(f.clips().length === b.count - 1 && !f.byName("B"), "B not deleted") },
	"ripple-delete": { expect: (f, b) => expectThat(f.clips().length === b.count - 1, "B not deleted") },
	"cut-selected": { expect: (f, b, e) => expectThat(f.clips().length === b.count - 1 && e.clipboard.hasEntry(), "B not cut") },
	"copy-selected": { expect: (_, __, e) => expectThat(e.clipboard.hasEntry(), "clipboard empty") },
	"paste-copied": {
		setup: (_, e) => void e.clipboard.copy(),
		// At the playhead inside B: the copy goes in and B is cut around it, so there are more clips, not just one more.
		expect: (f, b) => expectThat(f.allClips().length > b.count, "nothing pasted"),
	},
	"paste-over": { setup: (_, e) => void e.clipboard.copy(), expect: (f, b) => expectThat(f.clips().length >= b.count, "paste over failed") },
	undo: {
		setup: (f, e) => e.timeline.deleteElements({ elements: [{ trackId: f.mainTrackId, elementId: "key-check-B" }] }),
		expect: (f) => expectThat(Boolean(f.byName("B")), "B not back"),
	},
	redo: {
		setup: (f, e) => {
			e.timeline.deleteElements({ elements: [{ trackId: f.mainTrackId, elementId: "key-check-B" }] });
			e.command.undo();
		},
		expect: (f) => expectThat(!f.byName("B"), "delete not redone"),
	},
	"select-all": { expect: (f) => expectThat(f.selected().length === 3, `${f.selected().length} selected`) },
	"select-backward": { expect: (f) => expectThat(f.selected().includes("key-check-A") && !f.selected().includes("key-check-C"), `selected ${f.selected()}`) },
	"select-forward": { expect: (f) => expectThat(f.selected().includes("key-check-C") && !f.selected().includes("key-check-A"), `selected ${f.selected()}`) },
	"cancel-interaction": { expect: (f) => expectThat(f.selected().length === 0, "selection kept") },
	"deselect-all": { expect: (f) => expectThat(f.selected().length === 0, "selection kept") },
	"toggle-snapping": {
		setup: () => useTimelineStore.setState({ snappingEnabled: true }),
		expect: () => expectThat(!useTimelineStore.getState().snappingEnabled, "snapping still on"),
	},
	"toggle-elements-visibility-selected": { expect: (f, b) => expectThat(Boolean((f.byName("B") as { hidden?: boolean })?.hidden) !== b.hiddenB, "B not disabled") },
	"mark-in": { expect: (f) => expectThat(useInOutStore.getState().inPoint === f.sec(4.5), "In not at the playhead") },
	"mark-out": { expect: (f) => expectThat(useInOutStore.getState().outPoint === f.sec(4.5), "Out not at the playhead") },
	"mark-clip": { expect: (f) => expectThat(useInOutStore.getState().inPoint === f.sec(3) && useInOutStore.getState().outPoint === f.sec(6), "range is not clip B") },
	"clear-in-out": {
		setup: (f) => useInOutStore.getState().setRange({ start: f.sec(1), end: f.sec(2) }),
		expect: () => expectThat(useInOutStore.getState().inPoint === null && useInOutStore.getState().outPoint === null, "range kept"),
	},
	"toggle-bookmark": { expect: (_, b, e) => expectThat(e.scenes.getActiveScene().bookmarks.length === b.markers + 1, "no marker added") },
	"add-marker-alt-color": { expect: (_, b, e) => expectThat(e.scenes.getActiveScene().bookmarks.some((m) => Boolean(m.color)), `markers ${b.markers}, none colored`) },
	"next-marker": { expect: (f) => expectThat(near(f.seconds(), 7), `at ${f.seconds()}s`) },
	"previous-marker": { expect: (f) => expectThat(near(f.seconds(), 1), `at ${f.seconds()}s`) },
	"volume-up": { expect: (_, b, e) => expectThat(snapshot(fixtureOf(e), e).volume === b.volume + 1, "volume not +1 dB") },
	"volume-down": { expect: (_, b, e) => expectThat(snapshot(fixtureOf(e), e).volume === b.volume - 1, "volume not −1 dB") },
	"toggle-keyframe-panel": { expect: () => expectThat(useTimelineStore.getState().expandedElementIds.has("key-check-B"), "keyframe lanes not open") },
	"toggle-keyframe": { expect: (_, b, e) => expectThat(snapshot(fixtureOf(e), e).keys !== b.keys, "no key added / removed") },
	"toggle-guides": { setup: () => usePreviewStore.setState({ activeGuide: null }), expect: () => expectThat(usePreviewStore.getState().activeGuide !== null, "guides not shown") },
	"toggle-rulers": { setup: () => usePreviewStore.setState({ overlays: {} }), expect: () => expectThat(usePreviewStore.getState().overlays.rulers === true, "rulers not shown") },
	"export-project": { expect: () => expectThat(useShellStore.getState().exportOpen, "export not opened") },
	"show-shortcuts": { expect: () => expectThat(useShellStore.getState().dialog === "shortcuts", "window not opened") },
};

/** A key that opens a window or menu (⇧⌘V «Paste Attributes», ⌘R…): Esc closes it, as a person would, before the next key. */
async function closeOverlays(): Promise<void> {
	for (let attempt = 0; attempt < 3; attempt++) {
		if (!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]')) return;
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
		await frames(2);
	}
}

let current: Fixture | null = null;
const fixtureOf = (_: EditorCore) => {
	if (!current) throw new Error("no fixture");
	return current;
};

export async function runKeyCheck({ only }: { only?: string[] } = {}): Promise<{ rows: KeyCheckRow[]; failed: KeyCheckRow[]; framesRunning: boolean }> {
	const editor = EditorCore.getInstance();
	const f = fixture(editor);
	current = f;
	const rows: KeyCheckRow[] = [];
	const keymap = [...useKeybindingsStore.getState().keybindings].filter(([, action]) => !only || only.includes(action));
	framesRunning = await probeFrames();
	try {
		for (const [key, action] of keymap) {
			f.reset();
			const check = CHECKS[action];
			check?.setup?.(f, editor);
			await frames(1);
			const before = snapshot(f, editor);
			let calls = 0;
			const spy = () => {
				calls++;
			};
			bindAction(action, spy as never);
			const pressed = !NOT_PRESSED.has(action);
			let resolved = useKeybindingsStore.getState().getKeybindingString(keydown(key)) === key;
			if (pressed) {
				document.dispatchEvent(keydown(key));
				await frames(2);
				if (check?.settle) await wait(check.settle);
			} else {
				resolved = resolved && useKeybindingsStore.getState().keybindings.get(key) === action;
			}
			unbindAction(action, spy as never);
			const fired = pressed ? calls > 0 : resolved;
			const problem = !fired ? "the key did not reach its command" : pressed && check ? check.expect(f, before, editor) : null;
			rows.push({ key, action, pressed, fired, ok: fired && !problem, detail: problem ?? (pressed ? (check ? "checked" : "fired") : "resolved") });
			editor.playback.pause();
			useShellStore.getState().setDialog(null as never);
			useShellStore.getState().setExportOpen(false);
			await closeOverlays();
		}
	} finally {
		f.restore();
		current = null;
	}
	return { rows, failed: rows.filter((row) => !row.ok), framesRunning };
}

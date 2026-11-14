import { useEffect } from "react";
import { invokeAction } from "@/actions";
import { useEditor } from "@/editor/use-editor";
import { useKeybindingsStore } from "@/actions/keybindings-store";
import { isTypableDOMElement } from "@/utils/browser";
import type { TActionWithOptionalArgs } from "@/actions";
import { FIELD_SAFE_ACTIONS, OWN_ARROW_ROLES } from "@/actions/keybinding-scope";
import { isSourceActive, routeSourceAction } from "@/components/editor/panels/assets/source/source-store";
import { shuttleStopKey } from "@/actions/shuttle";
import {
	handleDialogEnter,
	handleTileKey,
	installTilePointerTracking,
	isKeyboardOverlayOpen,
	isModalOverlayOpen,
	isTextEntryElement,
	leaveTiles,
	isFocusFromTab,
	noteFocusInput,
	spacePressesFocused,
	tabStaysInInspector,
} from "@/keyboard/navigation";

/** Actions that keep firing while the key is held (others run once per press). */
const REPEATABLE_ACTIONS: ReadonlySet<TActionWithOptionalArgs> = new Set([
	"frame-step-forward",
	"frame-step-backward",
	"frame-step-forward-large",
	"frame-step-backward-large",
	"previous-edit",
	"next-edit",
	"nudge-left",
	"nudge-right",
	"nudge-left-large",
	"nudge-right-large",
	"undo",
	"redo",
	"timeline-zoom-in",
	"timeline-zoom-out",
	"seek-forward",
	"seek-backward",
	"jump-forward",
	"jump-backward",
	"previous-keyframe",
	"next-keyframe",
	"previous-marker",
	"next-marker",
	"volume-up",
	"volume-down",
	"player-zoom-in",
	"player-zoom-out",
	// the trim model: a clip slipped frame by frame while the key is held
	"slip-left",
	"slip-right",
	"slip-left-large",
	"slip-right-large",
]);

/**
 * a composable that hooks to the caller component's
 * lifecycle and hooks to the keyboard events to fire
 * the appropriate actions based on keybindings
 */
const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

/**
 * Global hotkeys: one capture listener for the whole editor, matched by physical key.
 * They work whatever panel has focus, except while typing in a text field and while a
 * dialog, popover or menu owns the keyboard. Asset tiles and dialogs get Enter/arrows first.
 */
export function useKeybindingsListener() {
	const editor = useEditor();
	const { keybindings, getKeybindingString, isLoadingProject, isRecording } =
		useKeybindingsStore();

	useEffect(() => {
		const eventOptions: AddEventListenerOptions = { capture: true };
		// Keys we handled on keydown: their keyup must not click a focused button (Space/Enter).
		const handledCodes = new Set<string>();

		const handleKeyDown = (ev: KeyboardEvent) => {
			if (ev.key === "Tab") noteFocusInput({ byTab: true });
			const normalizedKey = (ev.key ?? "").toLowerCase();

			if (isLoadingProject || isRecording || ev.isComposing) return;
			// K held: J / L step a frame (shuttle.ts).
			const pressed = getKeybindingString(ev);
			if (pressed && keybindings.get(pressed) === "shuttle-stop" && !isTextEntryElement(document.activeElement)) shuttleStopKey.press(ev.code);
			if (handleDialogEnter(ev)) return;

			// Source preview: with a media item loaded and the focus in the Media panel, the transport
			// and marking keys (Space, J K L, I O, ← →, Home / End) act on the source, not the timeline.
			const sourceBinding = getKeybindingString(ev);
			const sourceAction = sourceBinding ? keybindings.get(sourceBinding) : undefined;
			if (
				sourceAction &&
				!isTextEntryElement(document.activeElement) &&
				!isModalOverlayOpen() &&
				// CapCut: while a media item is open in the player, ← / → step its frames even with a tile focused
				// (a click on a tile opens it there), so I and O mark where the user stepped to.
				isSourceActive()
			) {
				const handled = ev.repeat && sourceAction === "toggle-play" ? true : routeSourceAction(sourceAction);
				if (handled) {
					ev.preventDefault();
					ev.stopPropagation();
					handledCodes.add(ev.code);
					return;
				}
			}

			// Play / pause (Space) is the transport key: it works whatever was clicked last — a tile,
			// a button, a checkbox, a popover — except while typing in a text field or when a modal
			// dialog / open menu has the keyboard. It also takes the focus off the left-panel tiles.
			const playBinding = getKeybindingString(ev);
			if (playBinding && keybindings.get(playBinding) === "toggle-play") {
				if (isTextEntryElement(document.activeElement) || isModalOverlayOpen() || spacePressesFocused({ element: document.activeElement, reachedWithTab: isFocusFromTab() })) return;
				ev.preventDefault();
				ev.stopPropagation();
				handledCodes.add(ev.code);
				leaveTiles();
				if (ev.repeat) return;
				invokeAction("toggle-play", undefined, "keypress");
				return;
			}

			if (isKeyboardOverlayOpen()) return;
			if (handleTileKey(ev)) {
				handledCodes.add(ev.code);
				return;
			}

			const binding = getKeybindingString(ev);
			const activeElement = document.activeElement;
			const isTextInput =
				activeElement instanceof HTMLElement &&
				isTypableDOMElement({ element: activeElement });
			const boundAction = binding ? keybindings.get(binding) : undefined;

			if (normalizedKey === "escape" && isTextInput) {
				// Fields that undo their own typing on Esc (the Properties panel) see the key first; the blur follows.
				if (activeElement.closest("[data-handles-escape]")) {
					setTimeout(() => {
						if (document.activeElement === activeElement) activeElement.blur();
					}, 0);
					return;
				}
				activeElement.blur();
				return;
			}

			if (!binding) return;
			if (!boundAction) return;

			if (isTextInput && !FIELD_SAFE_ACTIONS.has(boundAction)) return;
			if ((boundAction === "focus-next-panel" || boundAction === "focus-previous-panel") && tabStaysInInspector(ev)) return;
			const role = activeElement instanceof HTMLElement ? activeElement.getAttribute("role") : null;
			if (role && OWN_ARROW_ROLES.has(role) && NAV_KEYS.has(ev.key)) return;
			if (ev.repeat && !REPEATABLE_ACTIONS.has(boundAction)) {
				ev.preventDefault();
				return;
			}
			if (boundAction === "paste-copied") {
				if (!editor.clipboard.hasEntry()) return;
				ev.preventDefault();
				invokeAction("paste-copied", undefined, "keypress");
				return;
			}

			ev.preventDefault();
			handledCodes.add(ev.code);

			switch (boundAction) {
				case "seek-forward":
					invokeAction("seek-forward", { seconds: 1 }, "keypress");
					break;
				case "seek-backward":
					invokeAction("seek-backward", { seconds: 1 }, "keypress");
					break;
				case "jump-forward":
					invokeAction("jump-forward", { seconds: 5 }, "keypress");
					break;
				case "jump-backward":
					invokeAction("jump-backward", { seconds: 5 }, "keypress");
					break;
				default:
					invokeAction(boundAction, undefined, "keypress");
			}
		};

		const handleKeyUp = (ev: KeyboardEvent) => {
			shuttleStopKey.release(ev.code);
			if (!handledCodes.delete(ev.code)) return;
			// The key's release must not "click" the focused button (Space / Enter) either.
			ev.preventDefault();
			ev.stopPropagation();
		};

		document.addEventListener("keydown", handleKeyDown, eventOptions);
		document.addEventListener("keyup", handleKeyUp, eventOptions);
		// A K let go while the window was in the background sends no keyup here.
		window.addEventListener("blur", shuttleStopKey.reset);
		const stopTileTracking = installTilePointerTracking();

		return () => {
			document.removeEventListener("keydown", handleKeyDown, eventOptions);
			document.removeEventListener("keyup", handleKeyUp, eventOptions);
			window.removeEventListener("blur", shuttleStopKey.reset);
			stopTileTracking();
		};
	}, [keybindings, getKeybindingString, isLoadingProject, isRecording, editor]);
}

import { useMemo } from "react";
import { useEditor } from "@/editor/use-editor";
import type { EditorCore } from "@/core";
import type { ElementRef } from "@/timeline/types";
import { type ClickKeys, clickSelection } from "@/timeline/selection-click";
import { expandToGroups } from "@/timeline/groups";

const isSameRef = (a: ElementRef, b: ElementRef) =>
	a.trackId === b.trackId && a.elementId === b.elementId;

/** The selection after a click on `target` with these keys (one rule for every place a clip can be clicked). */
export function clickSelect(editor: EditorCore, target: ElementRef, keys: ClickKeys): void {
	const tracks = editor.scenes.getActiveScene().tracks;
	const next = clickSelection({ tracks, current: editor.selection.getSelectedElements(), anchor: editor.selection.getSelectionAnchor(), target, keys });
	// A grouped clip (⌘G) never comes alone: the rest of its group joins the selection.
	editor.selection.setSelectedElements({ elements: expandToGroups({ tracks, elements: next.elements }), anchor: next.anchor });
}

/**
 * Selection actions that read the LIVE selection when called. Their identities never change, and using
 * them does not subscribe to the selection.
 */
function buildSelectionActions(editor: EditorCore) {
	const getSelectedElements = () => editor.selection.getSelectedElements();
	const getTracks = () => editor.scenes.getActiveScene().tracks;
	// A grouped clip (⌘G) never comes alone: the rest of its group joins the selection.
	const setElementSelection = ({ elements }: { elements: ElementRef[] }) => {
		editor.selection.setSelectedElements({ elements: expandToGroups({ tracks: getTracks(), elements }) });
	};
	/** The clip and the other members of its group. */
	const groupOf = (ref: ElementRef) => expandToGroups({ tracks: getTracks(), elements: [ref] });
	const isElementSelected = (ref: ElementRef) =>
		getSelectedElements().some((element) => isSameRef(element, ref));
	const selectElement = ({ trackId, elementId }: ElementRef) => {
		setElementSelection({ elements: [{ trackId, elementId }] });
	};
	const addElementToSelection = ({ trackId, elementId }: ElementRef) => {
		if (isElementSelected({ trackId, elementId })) return;
		setElementSelection({
			elements: [...getSelectedElements(), { trackId, elementId }],
		});
	};
	const removeElementFromSelection = (ref: ElementRef) => {
		const group = new Set(groupOf(ref).map((member) => member.elementId));
		editor.selection.setSelectedElements({
			elements: getSelectedElements().filter(
				(element) => !group.has(element.elementId),
			),
		});
	};
	const toggleElementSelection = (ref: ElementRef) => {
		if (isElementSelected(ref)) {
			removeElementFromSelection(ref);
		} else {
			addElementToSelection(ref);
		}
	};
	const clearElementSelection = () => {
		editor.selection.clearSelection();
	};
	/**
	 * Merges elements into the current selection, deduplicating by identity.
	 * Used for additive box-select where the pre-drag selection is preserved.
	 */
	const mergeElementsIntoSelection = ({
		elements,
	}: {
		elements: ElementRef[];
	}) => {
		const merged = [
			...getSelectedElements().filter(
				(selectedElement) =>
					!elements.some((element) => isSameRef(element, selectedElement)),
			),
			...elements,
		];
		setElementSelection({ elements: merged });
	};
	/**
	 * A click on a clip, wherever it lands (body, edge, beside a cut; either tool): one rule — timeline/selection-click.ts.
	 * Plain: that clip; ⌘: toggle it; ⇧: from the anchor to it in timeline order across the tracks they span.
	 */
	const handleElementClick = ({
		trackId,
		elementId,
		isMultiKey,
		isRangeKey = false,
	}: ElementRef & { isMultiKey: boolean; isRangeKey?: boolean }) => {
		clickSelect(editor, { trackId, elementId }, { range: isRangeKey, toggle: isMultiKey && !isRangeKey });
	};
	return {
		getSelectedElements,
		isElementSelected,
		groupOf,
		selectElement,
		setElementSelection,
		mergeElementsIntoSelection,
		addElementToSelection,
		removeElementFromSelection,
		toggleElementSelection,
		clearElementSelection,
		handleElementClick,
	};
}

/**
 * The selection actions only. A component that just acts on the selection (the timeline shell, its
 * drag/resize/box-select controllers) does not re-render when the selection changes.
 */
export function useElementSelectionActions() {
	const editor = useEditor();
	return useMemo(() => buildSelectionActions(editor), [editor]);
}

/** The selected elements (re-renders when they change) plus the selection actions. */
export function useElementSelection() {
	const selectedElements = useEditor(
		(e) => e.selection.getSelectedElements(),
		["selection"],
	);
	const actions = useElementSelectionActions();
	return { selectedElements, ...actions };
}

"use client";

import type { ReactElement } from "react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { EditorCore } from "@/core";
import type { ParamValue } from "@/params";
import { type CopiedValues, setCopiedValues, useParamValueClipboard } from "@/params/value-clipboard";
import { applyParamValues, type ClipScope, countParamTargets, paramValuesPatch, readParamValues } from "@/actions/apply-to-all";
import { toast } from "sonner";

/** How a row copies and pastes its value; rows without one use the selected clips' params named by the row id. */
export interface RowValueClipboard {
	copy: () => CopiedValues | null;
	canPaste: (copied: CopiedValues) => boolean;
	paste: (copied: CopiedValues) => void;
}

/** Rows that show several params at once. */
const ROW_PARAM_KEYS: Record<string, string[]> = {
	position: ["transform.positionX", "transform.positionY"],
	scale: ["transform.scaleX", "transform.scaleY"],
	rotation: ["transform.rotate"],
};

function selectedClips() {
	const editor = EditorCore.getInstance();
	return editor.timeline.getElementsWithTracks({ elements: editor.selection.getSelectedElements() });
}

/** The selected clips' own params behind a row (Position, Scale, Opacity, Volume…). */
function clipParamsClipboard(rowId: string, label: string): RowValueClipboard {
	const keys = ROW_PARAM_KEYS[rowId] ?? [rowId];
	const mapped = (copied: CopiedValues): Record<string, ParamValue> | null => {
		if (keys.every((key) => key in copied.values)) return Object.fromEntries(keys.map((key) => [key, copied.values[key]]));
		const values = Object.values(copied.values);
		// One number into another one-number row (opacity → volume is allowed, X/Y pairs only into pairs).
		return keys.length === 1 && values.length === 1 && typeof values[0] === "number" ? { [keys[0]]: values[0] } : null;
	};
	return {
		copy: () => {
			for (const { element } of selectedClips()) {
				const values = readParamValues(element, keys);
				if (values) return { values, label };
			}
			return null;
		},
		canPaste: (copied) => {
			const values = mapped(copied);
			return values !== null && selectedClips().some(({ element }) => paramValuesPatch(element, values) !== null || readParamValues(element, keys) !== null);
		},
		paste: (copied) => {
			const values = mapped(copied);
			if (values) applyParamValues(EditorCore.getInstance(), values, "selected");
		},
	};
}

/**
 * Right-click on an inspector row (not inside a text field, which keeps the system's Copy/Paste): Copy value, or
 * Paste a value copied from another row of the same kind.
 */
export function RowValueMenu({
	rowId,
	label,
	clipboard,
	children,
}: {
	rowId?: string;
	label: string;
	clipboard?: RowValueClipboard;
	children: ReactElement;
}) {
	if (!rowId && !clipboard) return children;
	const actions = clipboard ?? clipParamsClipboard(rowId as string, label);
	return (
		<ContextMenu>
			<ContextMenuTrigger
				asChild
				onContextMenuCapture={(event) => {
					if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable='true']")) {
						event.stopPropagation();
					}
				}}
			>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent>
				<RowValueMenuItems actions={actions} />
			</ContextMenuContent>
		</ContextMenu>
	);
}

/** Rendered only while the menu is open: what can be pasted and applied is worked out then, not on every edit. */
function RowValueMenuItems({ actions }: { actions: RowValueClipboard }) {
	const copied = useParamValueClipboard((state) => state.copied);
	const canPaste = copied !== null && actions.canPaste(copied);
	const own = actions.copy();
	const editor = EditorCore.getInstance();
	const targets = (scope: ClipScope) => (own ? countParamTargets(editor, Object.keys(own.values), scope) : 0);
	// «Apply to all»: this row's value onto the other selected clips, or every clip of their tracks (one ⌘Z).
	const applyTo = (scope: ClipScope) => {
		if (!own) return;
		const changed = applyParamValues(editor, own.values, scope);
		if (changed > 0) toast.success(`${own.label} applied to ${changed} ${changed === 1 ? "clip" : "clips"}`);
	};
	return (
		<>
			<ContextMenuItem disabled={!own} onSelect={() => own && setCopiedValues(own)}>
				Copy value
			</ContextMenuItem>
			<ContextMenuItem disabled={!canPaste} onSelect={() => copied && actions.paste(copied)}>
				{canPaste && copied ? `Paste value (${copied.label})` : "Paste value"}
			</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem data-apply-scope="selected" disabled={targets("selected") < 2} onSelect={() => applyTo("selected")}>
				Apply to selected clips
			</ContextMenuItem>
			<ContextMenuItem data-apply-scope="track" disabled={targets("track") < 2} onSelect={() => applyTo("track")}>
				Apply to all clips on the track
			</ContextMenuItem>
		</>
	);
}

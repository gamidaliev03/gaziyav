import { useRef, useState } from "react";
import { EditorCore } from "@/core";
import { evaluateMathExpression } from "@/utils/math";
import { evaluateNumberInput, looksLikeExpression, nudgeNumberInput } from "./number-input";

/**
 * A typed value while its field has the focus. Typing previews live, Enter or leaving the field
 * commits (one undo step), Esc throws the typing away and puts the old value back.
 *
 * `numeric`: the field holds a number. A decimal comma counts as a point («1,5» = 1.5) and an expression previews
 * its result while it is typed (./number-input.ts). `nudge`: ↑/↓ change it by a step (Shift ×10), previewed like
 * typing and committed by Enter or leaving the field.
 */
export function usePropertyDraft<T>({
	displayValue: sourceDisplay,
	parse,
	onPreview,
	onCommit,
	onStartEditing,
	onCancel = discardTimelinePreview,
	supportsExpressions = true,
	numeric = false,
	nudge,
}: {
	displayValue: string;
	parse: (input: string) => T | null;
	onPreview: (value: T) => void;
	onCommit: () => void;
	onStartEditing?: () => void;
	/** Esc: undo the live preview. Default: drop the timeline's pending preview. */
	onCancel?: () => void;
	supportsExpressions?: boolean;
	numeric?: boolean;
	nudge?: {
		/** What one ↑/↓ adds, in the units the field shows. */
		step: number;
		/** How the field writes the value after ↑/↓. */
		format: (value: number) => string;
	};
}) {
	const [isEditing, setIsEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const cancelled = useRef(false);

	/** The value a typed text gives, or null while it isn't one yet. */
	const parseTyped = (input: string): T | null => {
		if (!numeric) return parse(input);
		const value = evaluateNumberInput({ input, supportsExpressions });
		return value === null ? null : parse(String(value));
	};

	return {
		displayValue: isEditing ? draft : sourceDisplay,
		scrubTo: (value: number) => {
			const parsed = parse(String(value));
			if (parsed !== null) onPreview(parsed);
		},
		commitScrub: onCommit,
		onFocus: () => {
			cancelled.current = false;
			setIsEditing(true);
			setDraft(sourceDisplay);
			onStartEditing?.();
		},
		onChange: (
			event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
		) => {
			const nextDraft = event.target.value;
			setDraft(nextDraft);

			const parsed = parseTyped(nextDraft);
			if (parsed !== null) {
				onPreview(parsed);
			}
		},
		onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
			const arrow = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
			if (nudge && arrow && !event.metaKey && !event.ctrlKey && !event.altKey) {
				// The field's own number, not a caret move or an editor shortcut.
				event.preventDefault();
				event.stopPropagation();
				const next = nudgeNumberInput({ input: event.currentTarget.value, direction: arrow, step: nudge.step, shiftKey: event.shiftKey });
				const parsed = next === null ? null : parse(String(next));
				if (parsed === null) return;
				setIsEditing(true);
				setDraft(nudge.format(Number(parsed)));
				onPreview(parsed);
				return;
			}
			if (event.key !== "Escape") return;
			cancelled.current = true;
			onCancel();
		},
		onBlur: (
			event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
		) => {
			if (cancelled.current) {
				cancelled.current = false;
				setIsEditing(false);
				setDraft("");
				return;
			}
			const nextDraft = event.target.value;
			// A numeric field already previewed what was typed (expressions included) while typing; previewing the shown
			// value again on leave put a keyframe at the playhead of an animated value that nobody had changed.
			if (!numeric && supportsExpressions && looksLikeExpression({ input: nextDraft })) {
				const evaluated = evaluateMathExpression({ input: nextDraft });
				if (evaluated !== null) {
					const parsed = parse(String(evaluated));
					if (parsed !== null) onPreview(parsed);
				}
			}
			onCommit();
			setIsEditing(false);
			setDraft("");
		},
	};
}

function discardTimelinePreview() {
	EditorCore.getInstance().timeline.discardPreview();
}

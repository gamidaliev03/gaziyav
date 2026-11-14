// «Copy value» / «Paste value» on any parameter row of the inspector (right-click): kept until the next copy. A row
// can hold several params (Position = X and Y); a value pastes into a row of the same kind (a number into a number,
// a colour into a colour…), onto every selected clip at once: one ⌘Z.
import { create } from "zustand";
import type { ParamDefinition, ParamValue } from "@/params";

export interface CopiedValues {
	values: Record<string, ParamValue>;
	/** The param type, when copied from a typed field (effect params, text style…). */
	type?: ParamDefinition["type"];
	label: string;
}

export const useParamValueClipboard = create<{ copied: CopiedValues | null }>()(() => ({ copied: null }));

export function setCopiedValues(copied: CopiedValues): void {
	useParamValueClipboard.setState({ copied });
}

/** The copied value as this param would take it (numbers clamped to its range), or null when it doesn't fit. */
export function pastableValue(param: ParamDefinition, copied: CopiedValues | null): ParamValue | null {
	if (!copied) return null;
	const entries = Object.entries(copied.values);
	const value = copied.values[param.key] ?? (entries.length === 1 ? entries[0][1] : undefined);
	if (value === undefined) return null;
	if (copied.type ? copied.type !== param.type : typeof value !== (param.type === "number" ? "number" : param.type === "boolean" ? "boolean" : "string")) {
		return null;
	}
	if (param.type === "number" && typeof value === "number") {
		return Math.min(param.max ?? Number.POSITIVE_INFINITY, Math.max(param.min, value));
	}
	if (param.type === "select") {
		const options = (param as { options?: Array<{ value: ParamValue }> }).options;
		return options && !options.some((option) => option.value === value) ? null : value;
	}
	return value;
}

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { EditorCore } from "@/core";

const SNAPSHOT_UNSET = Symbol("snapshotUnset");

function isShallowEqual({
	a,
	b,
}: {
	a: unknown;
	b: unknown;
}): boolean {
	if (Object.is(a, b)) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return a.every((item, i) => Object.is(item, b[i]));
	}
	if (isPlainObject(a) && isPlainObject(b)) {
		const keysA = Object.keys(a);
		if (keysA.length !== Object.keys(b).length) return false;
		return keysA.every(
			(key) =>
				Object.prototype.hasOwnProperty.call(b, key) && Object.is(a[key], b[key]),
		);
	}
	return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object") return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/** Managers a selector can subscribe to. Narrow lists keep hot components
 * (timeline elements) from re-running selectors on every playback tick. */
export type EditorManagerKey =
	| "playback"
	| "timeline"
	| "scenes"
	| "project"
	| "media"
	| "renderer"
	| "selection"
	| "clipboard"
	| "diagnostics";

const ALL_MANAGERS: readonly EditorManagerKey[] = [
	"playback",
	"timeline",
	"scenes",
	"project",
	"media",
	"renderer",
	"selection",
	"clipboard",
	"diagnostics",
];

const subscribeNone = () => () => {};

export function useEditor(): EditorCore;
export function useEditor<T>(
	selector: (editor: EditorCore) => T,
	managers?: readonly EditorManagerKey[],
): T;
export function useEditor<T>(
	selector?: (editor: EditorCore) => T,
	managers?: readonly EditorManagerKey[],
): EditorCore | T {
	const editor = useMemo(() => EditorCore.getInstance(), []);
	const snapshotCacheRef = useRef<T | typeof SNAPSHOT_UNSET>(SNAPSHOT_UNSET);
	const managersKey = (managers ?? ALL_MANAGERS).join(",");

	const subscribeAll = useCallback(
		(onChange: () => void) => {
			const unsubscribers = (managersKey.split(",") as EditorManagerKey[]).map(
				(key) => editor[key].subscribe(onChange),
			);
			return () => {
				unsubscribers.forEach((unsubscribe) => {
					unsubscribe();
				});
			};
		},
		[editor, managersKey],
	);

	const getSnapshot = useCallback((): EditorCore | T => {
		if (!selector) {
			return editor;
		}

		const next = selector(editor);
		if (
			snapshotCacheRef.current !== SNAPSHOT_UNSET &&
			isShallowEqual({
				a: snapshotCacheRef.current,
				b: next,
			})
		) {
			return snapshotCacheRef.current;
		}

		snapshotCacheRef.current = next;
		return next;
	}, [editor, selector]);

	return useSyncExternalStore(
		selector ? subscribeAll : subscribeNone,
		getSnapshot,
		getSnapshot,
	);
}

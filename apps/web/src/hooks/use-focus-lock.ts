import { useEffect, useRef } from "react";
import { useCommittedRef } from "@/hooks/use-committed-ref";

type FocusLockCursor = "text" | "default" | "pointer" | "crosshair";

const DATA_ATTR = "data-focus-locked";

function buildFocusLockCSS({
	cursor,
	allowSelector,
}: {
	cursor: FocusLockCursor;
	allowSelector?: string;
}) {
	const rules = [
		`*, *::before, *::after { pointer-events: none !important; cursor: ${cursor} !important; }`,
		`[${DATA_ATTR}], [${DATA_ATTR}] * { pointer-events: auto !important; cursor: auto !important; }`,
	];

	if (allowSelector) {
		rules.push(
			`${allowSelector} { pointer-events: auto !important; cursor: auto !important; }`,
		);
	}

	return rules.join("\n");
}

export function useFocusLock<T extends HTMLElement = HTMLElement>({
	isActive,
	onDismiss,
	cursor = "default",
	allowSelector,
	blockOutside = true,
}: {
	isActive: boolean;
	onDismiss: () => void;
	cursor?: FocusLockCursor;
	allowSelector?: string;
	/**
	 * true: everything outside is inert while the lock is on, so the first click outside only dismisses. false: the
	 * click outside dismisses (the field commits on blur, before the click lands) and also does what it was for.
	 */
	blockOutside?: boolean;
}) {
	const containerRef = useRef<T>(null);
	const onDismissRef = useCommittedRef(onDismiss);

	useEffect(() => {
		if (!isActive) return;
		const container = containerRef.current;
		if (!container) return;

		container.setAttribute(DATA_ATTR, "");

		const focusLockStyle = blockOutside ? document.createElement("style") : null;
		if (focusLockStyle) {
			focusLockStyle.textContent = buildFocusLockCSS({ cursor, allowSelector });
			document.head.appendChild(focusLockStyle);
		}

		const handleOutsidePointerDown = (event: PointerEvent) => {
			if (event.button !== 0) return;
			const target = event.target;
			if (target instanceof Node && container.contains(target)) return;

			const isAllowedTarget =
				allowSelector &&
				target instanceof Element &&
				target.closest(allowSelector);
			if (isAllowedTarget) return;

			onDismissRef.current();
		};

		document.addEventListener("pointerdown", handleOutsidePointerDown, true);

		return () => {
			document.removeEventListener(
				"pointerdown",
				handleOutsidePointerDown,
				true,
			);
			container.removeAttribute(DATA_ATTR);
			focusLockStyle?.remove();
		};
	}, [isActive, cursor, allowSelector, blockOutside, onDismissRef]);

	return { containerRef };
}

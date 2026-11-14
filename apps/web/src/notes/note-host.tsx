"use client";

// <userData>/Notes/<time>/ with the window as it was before the field (shot.png) and note.json — his words, the element
// that was under the pointer, the editor's selection and playhead (GaziyavShell/modules/notes.js). Esc writes nothing.
// Invisible otherwise: no menu, no button, no text; it never touches the project, and focus goes back where it was.
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import { describeAncestors, describeElement, type ElementInfo } from "./describe";
import { startDiagnostics } from "./diag";

type NoteApi = (op: "begin" | "save" | "discard", token?: string, note?: unknown) => Promise<unknown>;
const api = (): NoteApi | null => (typeof window === "undefined" ? null : ((window as unknown as { studioApp?: { note?: NoteApi } }).studioApp?.note ?? null));

/** ⌃⌥⌘N by the physical key (any layout). */
const isShortcut = (e: KeyboardEvent) => e.code === "KeyN" && e.ctrlKey && e.altKey && e.metaKey && !e.shiftKey;

interface Pending {
	token: string;
	focus: Element | null;
	info: {
		route: string;
		window: { w: number; h: number };
		pointer: { x: number; y: number } | null;
		element: ElementInfo | null;
		ancestors: ElementInfo[];
		selection: unknown;
	};
}

async function selectionNow(): Promise<unknown> {
	if (!location.pathname.startsWith("/editor")) return null;
	try {
		const [{ EditorCore }, { mediaTimeToSeconds }] = await Promise.all([import("@/core"), import("@/wasm")]);
		const editor = EditorCore.peekInstance();
		const project = editor?.project.getActiveOrNull();
		if (!editor || !project) return null;
		return {
			projectId: project.metadata.id,
			elements: editor.selection.getSelectedElements().map((r) => r.elementId),
			tracks: editor.selection.getSelectedElements().map((r) => r.trackId),
			playhead: Math.round(mediaTimeToSeconds({ time: editor.playback.getCurrentTime() }) * 1000) / 1000,
		};
	} catch {
		return null;
	}
}

export function NoteHost() {
	const t = useT();
	const [state, setState] = useState<"closed" | "open" | "done">("closed");
	const input = useRef<HTMLInputElement>(null);
	const pending = useRef<Pending | null>(null);
	const busy = useRef(false);

	useEffect(() => {
		if (!api()) return;
		let pointer: { x: number; y: number } | null = null;
		const onPointer = (e: PointerEvent) => {
			pointer = { x: Math.round(e.clientX), y: Math.round(e.clientY) };
		};
		const restore = () => {
			const p = pending.current;
			const back = p?.focus as HTMLElement | null;
			if (back && back !== document.body && back.isConnected && typeof back.focus === "function") back.focus({ preventScroll: true });
			else input.current?.blur();
		};
		const close = (saved: boolean) => {
			restore();
			pending.current = null;
			if (!saved) {
				setState("closed");
				busy.current = false;
				return;
			}
			setState("done");
			setTimeout(() => {
				setState("closed");
				busy.current = false;
			}, 450);
		};
		const onKey = (e: KeyboardEvent) => {
			const ours = !!input.current && e.target === input.current;
			if (e.type === "keydown" && isShortcut(e)) {
				e.preventDefault();
				e.stopImmediatePropagation();
				if (busy.current || e.repeat) return;
				busy.current = true;
				const at = pointer;
				const under = at ? document.elementFromPoint(at.x, at.y) : null;
				const focus = document.activeElement;
				const info = {
					route: location.pathname,
					window: { w: innerWidth, h: innerHeight },
					pointer: at,
					element: under ? describeElement(under as unknown as HTMLElement) : null,
					ancestors: under ? describeAncestors(under as unknown as HTMLElement) : [],
					selection: null as unknown,
				};
				// the window first, then the field
				void Promise.all([api()?.("begin"), selectionNow()]).then(([token, selection]) => {
					if (typeof token !== "string") {
						busy.current = false;
						return;
					}
					info.selection = selection;
					pending.current = { token, focus, info };
					setState("open");
				});
				return;
			}
			if (!ours) return;
			// the field's keys belong to it alone: no shortcut, dialog or menu of the app sees them
			e.stopImmediatePropagation();
			if (e.type !== "keydown" || e.isComposing) return;
			const p = pending.current;
			if (e.key === "Escape") {
				e.preventDefault();
				if (p) void api()?.("discard", p.token);
				close(false);
			} else if (e.key === "Enter") {
				e.preventDefault();
				const text = input.current?.value.trim() ?? "";
				if (!p?.token || !text) return;
				void (api()?.("save", p.token, { text, ...p.info }) ?? Promise.resolve(false))
					.then((ok) => close(ok === true))
					.catch(() => close(false));
				pending.current = { ...p, token: "" };
			}
		};
		// focus moving into the field and back is not the app's business: a dialog's focus trap would pull it back,
		// and an input's blur would commit its value
		const onFocus = (e: FocusEvent) => {
			const f = input.current;
			if (f && (e.target === f || e.relatedTarget === f)) e.stopImmediatePropagation();
		};
		// a click outside the open field is an Esc
		const onDown = (e: PointerEvent) => {
			const p = pending.current;
			const f = input.current;
			if (!p?.token || !f || f.parentElement?.contains(e.target as Node)) return;
			void api()?.("discard", p.token);
			close(false);
		};
		const opts = { capture: true } as const;
		window.addEventListener("pointermove", onPointer, { capture: true, passive: true });
		window.addEventListener("pointerdown", onPointer, { capture: true, passive: true });
		window.addEventListener("pointerdown", onDown, opts);
		for (const type of ["keydown", "keyup", "keypress"] as const) window.addEventListener(type, onKey, opts);
		for (const type of ["focusin", "focusout", "focus", "blur"] as const) window.addEventListener(type, onFocus, opts);
		return () => {
			window.removeEventListener("pointermove", onPointer, opts);
			window.removeEventListener("pointerdown", onPointer, opts);
			window.removeEventListener("pointerdown", onDown, opts);
			for (const type of ["keydown", "keyup", "keypress"] as const) window.removeEventListener(type, onKey, opts);
			for (const type of ["focusin", "focusout", "focus", "blur"] as const) window.removeEventListener(type, onFocus, opts);
		};
	}, []);

	// the flight recorder's page side (src/notes/diag.ts), mounted with the field
	useEffect(() => startDiagnostics(), []);

	useEffect(() => {
		if (state === "open") input.current?.focus({ preventScroll: true });
	}, [state]);

	if (state === "closed") return null;
	return (
		<div
			data-gz-note={state}
			style={{ position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)", zIndex: 2147483647, pointerEvents: "auto" }}
		>
			{state === "open" ? (
				<input
					ref={input}
					placeholder={t("What's wrong?")}
					spellCheck={false}
					autoComplete="off"
					className="h-9 w-80 rounded-lg border border-border bg-popover px-3 text-sm text-popover-foreground shadow-lg outline-none"
				/>
			) : (
				<div aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-popover text-popover-foreground shadow-lg">
					✓
				</div>
			)}
		</div>
	);
}

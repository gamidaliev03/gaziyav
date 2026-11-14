"use client";
// Double-click a Gaziyav AI layer in the preview: its text is edited right there (like a normal text element),
// a picture opens "Replace from Media". The Remotion layer draws real DOM, so the text under the pointer is found
// and matched to the layer field that holds it. Instant, one ⌘Z, kept by follow-ups.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { KIND_BY_ID } from "../catalog";
import { findAiLayer, patchAiLayer } from "../compositions";
import type { MontageItem } from "../types";
import { type AiField, aiFields, fieldValue, ImageField, withField } from "./ai-fields";

interface Editing {
	item: { id: string; owner?: string };
	field: AiField;
	value: string;
	rect: { left: number; top: number; width: number; height: number };
	fontSize: number;
	image?: false;
}
interface Picking {
	item: { id: string; owner?: string };
	key: string;
	at: { left: number; top: number };
	image: true;
}

const squash = (t: string) => t.replace(/[*\n\s]+/g, "").toLowerCase();

/** Text fields of an AI layer: kit text fields or the fields its own component declared. */
function textFields(kind: string, params: Record<string, unknown>): AiField[] {
	if (kind === "Custom") return aiFields(params).filter((f) => f.type === "text");
	return (KIND_BY_ID.get(kind)?.fields ?? []).filter((f) => f.type === "text").map((f) => ({ key: f.key, label: f.label, type: "text" as const }));
}

function textUnder(root: Element, x: number, y: number): { text: string; el: HTMLElement } | null {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let hit: { text: string; el: HTMLElement } | null = null;
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		if (!n.textContent?.trim()) continue;
		const range = document.createRange();
		range.selectNodeContents(n);
		for (const r of range.getClientRects()) {
			if (x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4) hit = { text: n.textContent, el: n.parentElement as HTMLElement };
		}
	}
	return hit;
}

function imageUnder(root: Element, x: number, y: number): HTMLImageElement | null {
	let hit: HTMLImageElement | null = null;
	for (const img of root.querySelectorAll("img")) {
		const r = img.getBoundingClientRect();
		if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && /\/api\/montage\/asset\//.test(img.src)) hit = img;
	}
	return hit;
}

export function InlineEditor({ items }: { items: MontageItem[] }) {
	const [editing, setEditing] = useState<Editing | Picking | null>(null);
	const itemsRef = useRef(items);
	itemsRef.current = items;

	useEffect(() => {
		const onDouble = (event: MouseEvent) => {
			const layer = document.querySelector("[data-montage-layer]");
			if (!layer) return;
			const box = layer.getBoundingClientRect();
			const { clientX: x, clientY: y } = event;
			if (x < box.left || x > box.right || y < box.top || y > box.bottom) return;
			const owned = (el: Element | null) => el?.closest<HTMLElement>("[data-ai-item]");
			const text = textUnder(layer, x, y);
			const img = text ? null : imageUnder(layer, x, y);
			const holder = owned(text?.el ?? img ?? null);
			if (!holder) return;
			const id = holder.dataset.aiItem ?? "";
			const owner = holder.dataset.aiOwner || undefined;
			const item = itemsRef.current.find((i) => i.id === id && (i.owner ?? "") === (owner ?? ""));
			const element = findAiLayer(id);
			if (!item || !element) return;
			if (img) {
				const name = decodeURIComponent(img.src.split("/api/montage/asset/")[1] ?? "");
				let assets: Record<string, { name: string }> = {};
				try {
					assets = JSON.parse(String(element.params.assets ?? "{}"));
				} catch {}
				const key = Object.entries(assets).find(([, a]) => a?.name === name)?.[0];
				if (!key) return;
				event.preventDefault();
				event.stopPropagation();
				setEditing({ item: { id, owner }, key, at: { left: x, top: y }, image: true });
				return;
			}
			// The field holding the clicked words: an exact match first, then the field that contains them.
			const said = squash(text!.text);
			const fields = textFields(item.kind, element.params as Record<string, unknown>);
			const scored = fields
				.map((f) => ({ f, v: String(fieldValue(element.params as Record<string, unknown>, f) ?? "") }))
				.filter(({ v }) => v.trim())
				.map(({ f, v }) => ({ f, v, s: squash(v) === said ? 3 : squash(v).includes(said) ? 2 : said.includes(squash(v)) ? 1 : 0 }))
				.filter((x) => x.s > 0)
				.sort((a, b) => b.s - a.s);
			const best = scored[0];
			if (!best) return;
			event.preventDefault();
			event.stopPropagation();
			const r = (text!.el.closest("div") ?? text!.el).getBoundingClientRect();
			setEditing({
				item: { id, owner },
				field: best.f,
				value: best.v,
				rect: { left: r.left, top: r.top, width: Math.max(140, r.width), height: Math.max(28, r.height) },
				fontSize: Math.max(12, Math.min(18, Number.parseFloat(getComputedStyle(text!.el).fontSize) || 16)),
			});
		};
		window.addEventListener("dblclick", onDouble, true);
		return () => window.removeEventListener("dblclick", onDouble, true);
	}, []);

	if (!editing) return null;
	if (editing.image) {
		const element = findAiLayer(editing.item.id);
		if (!element) return null;
		return createPortal(
			<div data-ai-inline-image className="bg-popover fixed z-[60] w-80 rounded-md border p-2 shadow-xl" style={{ left: Math.min(editing.at.left, window.innerWidth - 330), top: Math.min(editing.at.top, window.innerHeight - 140) }}>
				<div className="mb-1.5 flex items-center justify-between">
					<span className="text-muted-foreground text-[11px]">Picture</span>
					<button type="button" className="text-muted-foreground hover:text-foreground text-[11px]" onClick={() => setEditing(null)}>
						Close
					</button>
				</div>
				<ImageField element={element} assetKey={editing.key} onDone={() => setEditing(null)} />
			</div>,
			document.body,
		);
	}
	return createPortal(<TextBox editing={editing} onClose={() => setEditing(null)} />, document.body);
}

function TextBox({ editing, onClose }: { editing: Editing; onClose: () => void }) {
	const [draft, setDraft] = useState(editing.value);
	const ref = useRef<HTMLTextAreaElement>(null);
	const done = useRef(false);
	useEffect(() => {
		ref.current?.focus();
		ref.current?.select();
	}, []);
	const commit = () => {
		if (done.current) return;
		done.current = true;
		if (draft !== editing.value) patchAiLayer({ elementId: editing.item.id, owner: editing.item.owner, patch: (p) => withField(p, editing.field, draft) });
		onClose();
	};
	return (
		<textarea
			ref={ref}
			data-ai-inline-text
			value={draft}
			rows={Math.max(1, draft.split("\n").length + (draft.length > 32 ? 1 : 0))}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				e.stopPropagation();
				if (e.key === "Escape") {
					done.current = true;
					onClose();
				} else if (e.key === "Enter" && !e.shiftKey) {
					e.preventDefault();
					commit();
				}
			}}
			className="fixed z-[60] resize-none rounded-md border border-amber-400 bg-black/80 px-2 py-1 text-white shadow-xl outline-none"
			style={{
				left: Math.max(8, Math.min(editing.rect.left - 6, window.innerWidth - 300)),
				top: editing.rect.top - 4,
				width: Math.max(editing.rect.width + 12, Math.min(420, draft.length * editing.fontSize * 0.62 + 24), 220),
				minHeight: editing.rect.height + 8,
				fontSize: editing.fontSize,
			}}
			title="Enter saves · Shift+Enter new line · Esc cancels"
		/>
	);
}

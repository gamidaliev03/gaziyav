// style, a template, a shape, an effect, a filter, a transition, a compound clip from Media, an AI result — the browser's
// own picture is a transparent pixel, and what follows the pointer is OUR element on the top layer: a compact chip (a
// small cover or the kind's glyph, the name on one line, the length when it has one), right-below the pointer so the drop
// point stays in view, slightly see-through. The tile it came from dims while its copy is in the hand. Over the timeline
// the chip shrinks to a tag: the timeline's own ghost shows the true landing place and length. Over a place that cannot
// take it, one quiet «cannot» look. On a drop it lands (the motion tokens, transform and opacity only); on Esc or a drop
// outside it goes back to its tile. It never takes the pointer (pointer-events: none) and costs nothing while idle (no
//
// Before it, each tile set its own picture (the browser's snapshot of the tile, a blue «♪ name» bar, an 80 px card);
// a tile's own setDragImage runs before this listener (it is on window, in the bubble phase), so this one wins.
// A Media tile whose file is dragged OUT of the window (media/drag-out.ts: the Mac's own file drag) keeps the Mac's
// picture: that drag is the system's, not the page's.
import { EditorCore } from "@/core";
import { timelineDragInHand } from "@/timeline/drag-source";
import type { TimelineDragData } from "@/timeline/drag";

const CHIP_MAX_W = 120;
const OFFSET = { x: 14, y: 16 };
const TRANSPARENT = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const CSS = `
.gz-drag-chip{position:fixed;left:0;top:0;z-index:4000;pointer-events:none;box-sizing:border-box;display:flex;align-items:center;gap:6px;
max-width:${CHIP_MAX_W}px;height:28px;padding:2px 8px 2px 2px;border-radius:var(--radius-md,6px);background:var(--popover,#13171d);
color:var(--popover-foreground,#f7f8fa);box-shadow:0 0 0 1px var(--border,#1e242c),0 8px 24px -8px rgb(0 0 0/.55);opacity:.9;
font:500 11px/1.2 -apple-system,system-ui,sans-serif;will-change:transform;contain:layout paint;
transition:opacity var(--gz-t1,120ms) var(--gz-ease,ease),height var(--gz-t1,120ms) var(--gz-ease,ease)}
.gz-drag-chip>i{flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:calc(var(--radius-md,6px) - 2px);overflow:hidden;
background:var(--popover-hover,#1f252e);font-style:normal;font-size:13px}
.gz-drag-chip>i>canvas{width:24px;height:24px;display:block}
.gz-drag-chip>b{flex:1 1 auto;min-width:0;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gz-drag-chip>s{flex:none;text-decoration:none;opacity:.6;font-variant-numeric:tabular-nums}
.gz-drag-chip>u{flex:none;text-decoration:none;font-weight:600;opacity:.8}
.gz-drag-chip[data-over="timeline"]{height:20px;padding:0 6px;max-width:96px;opacity:.82;font-size:10px}
.gz-drag-chip[data-over="timeline"]>i,.gz-drag-chip[data-over="timeline"]>s{display:none}
.gz-drag-chip[data-cannot]{opacity:.5;filter:grayscale(1)}
.gz-drag-chip[data-state="landed"]{opacity:0;transition:transform var(--gz-t2,200ms) var(--gz-ease,ease),opacity var(--gz-t2,200ms) var(--gz-ease,ease)}
.gz-drag-chip[data-state="back"]{opacity:0;transition:transform var(--gz-t3,320ms) var(--gz-ease,ease),opacity var(--gz-t3,320ms) var(--gz-ease,ease)}
[data-drag-source]{opacity:.4!important;transition:opacity var(--gz-t1,120ms) var(--gz-ease,ease)}
`;

const GLYPH: Record<string, string> = { text: "T", "library-audio": "♪", audio: "♪", sticker: "◆", graphic: "✶", effect: "✦", transition: "⇄", deferred: "✶", video: "▶", image: "▣" };

function coverOf(tile: HTMLElement): HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | null {
	for (const el of tile.querySelectorAll<HTMLImageElement | HTMLCanvasElement | HTMLVideoElement>("img, canvas, video")) {
		const r = el.getBoundingClientRect();
		if (r.width < 12 || r.height < 12) continue;
		if (el instanceof HTMLImageElement && !(el.complete && el.naturalWidth > 0)) continue;
		if (el instanceof HTMLVideoElement && el.readyState < 2) continue;
		return el;
	}
	return null;
}

const clock = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${s >= 10 ? Math.round(s) : s.toFixed(1).replace(/\.0$/, "")} s`);

/** The item's name, kind and length (seconds) as the drag says; the tile's own label as a fallback. */
function describe(tile: HTMLElement, data: TimelineDragData | null, mediaSeconds: (id: string) => number | undefined) {
	const label = (tile.getAttribute("aria-label") || tile.getAttribute("title") || tile.innerText || "").trim().split("\n")[0]?.split(" — ")[0] ?? "";
	if (!data) return { name: label, glyph: tile.closest("[data-transition-tile], [data-transitions]") ? GLYPH.transition : "✦", seconds: undefined as number | undefined, count: 1 };
	const ids = data.type === "media" ? (data.ids ?? [data.id]) : [];
	const seconds =
		"dur" in data && typeof data.dur === "number" && data.dur > 0
			? data.dur
			: ids.length > 0
				? ids.reduce((sum, id) => sum + (mediaSeconds(id) ?? 0), 0) || undefined
				: undefined;
	const glyph = data.type === "media" || data.type === "source-file" ? GLYPH[data.mediaType] : data.type === "deferred" ? GLYPH[data.elementType] : GLYPH[data.type];
	return { name: data.name || label, glyph: glyph ?? "✦", seconds, count: Math.max(1, ids.length) };
}

function buildChip(tile: HTMLElement, data: TimelineDragData | null, mediaSeconds: (id: string) => number | undefined): HTMLElement {
	const { name, glyph, seconds, count } = describe(tile, data, mediaSeconds);
	const chip = document.createElement("div");
	chip.className = "gz-drag-chip";
	chip.setAttribute("data-drag-chip", "");
	chip.setAttribute("aria-hidden", "true");
	const icon = document.createElement("i");
	const cover = data?.type === "library-audio" ? null : coverOf(tile);
	if (cover) {
		const canvas = document.createElement("canvas");
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		canvas.width = canvas.height = 24 * dpr;
		try {
			const w = cover instanceof HTMLImageElement ? cover.naturalWidth : cover instanceof HTMLVideoElement ? cover.videoWidth : cover.width;
			const h = cover instanceof HTMLImageElement ? cover.naturalHeight : cover instanceof HTMLVideoElement ? cover.videoHeight : cover.height;
			const side = Math.min(w, h);
			canvas.getContext("2d")?.drawImage(cover, (w - side) / 2, (h - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
			icon.appendChild(canvas);
		} catch {
			icon.textContent = glyph;
		}
	} else icon.textContent = glyph;
	chip.appendChild(icon);
	const label = document.createElement("b");
	label.textContent = name;
	chip.appendChild(label);
	if (count > 1) {
		const n = document.createElement("u");
		n.textContent = `×${count}`;
		chip.appendChild(n);
	} else if (seconds) {
		const len = document.createElement("s");
		len.textContent = clock(seconds);
		chip.appendChild(len);
	}
	return chip;
}

/** Installs the chip for every drag in the page; returns the uninstaller. */
export function installDragGhost(options: { mediaSeconds?: (id: string) => number | undefined } = {}): () => void {
	const mediaSeconds =
		options.mediaSeconds ??
		((id: string) => {
			try {
				return EditorCore.getInstance().media.getAssets().find((asset) => asset.id === id)?.duration ?? undefined;
			} catch {
				return undefined;
			}
		});
	const style = document.createElement("style");
	style.setAttribute("data-drag-chip-css", "");
	style.textContent = CSS;
	document.head.appendChild(style);
	const transparent = new Image();
	transparent.src = TRANSPARENT;

	let chip: HTMLElement | null = null;
	let source: HTMLElement | null = null;
	let frame = 0;
	let at = { x: 0, y: 0 };
	let dropped = false;

	const place = () => {
		frame = 0;
		if (chip) chip.style.transform = `translate3d(${Math.round(at.x + OFFSET.x)}px, ${Math.round(at.y + OFFSET.y)}px, 0)`;
	};
	const finish = (how: "landed" | "back") => {
		const gone = chip;
		const from = source;
		chip = null;
		source = null;
		if (frame) cancelAnimationFrame(frame);
		frame = 0;
		from?.removeAttribute("data-drag-source");
		if (!gone) return;
		if (how === "back" && from?.isConnected) {
			const r = from.getBoundingClientRect();
			gone.style.transform = `translate3d(${Math.round(r.x)}px, ${Math.round(r.y)}px, 0) scale(.9)`;
		} else {
			gone.style.transform = `${gone.style.transform} scale(.6)`;
		}
		gone.setAttribute("data-state", how);
		const remove = () => gone.remove();
		gone.addEventListener("transitionend", remove, { once: true });
		// a reduced-motion look (or a tab in the background) may never end the transition
		window.setTimeout(remove, 600);
	};

	const onDragStart = (event: DragEvent) => {
		if (chip) finish("back");
		const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[draggable="true"]') : null;
		if (!target || !event.dataTransfer) return;
		// text dragged out of a field and links keep the browser's own picture; a file dragged out of the window is the Mac's
		if (target.matches("input, textarea, a[href]") || event.defaultPrevented) return;
		event.dataTransfer.setDragImage(transparent, 0, 0);
		dropped = false;
		source = target;
		target.setAttribute("data-drag-source", "");
		chip = buildChip(target, timelineDragInHand(), mediaSeconds);
		at = { x: event.clientX, y: event.clientY };
		place();
		document.body.appendChild(chip);
	};
	// After the targets' own handlers (bubble, on window): whether the place under the pointer takes the drag.
	const onDragOver = (event: DragEvent) => {
		if (!chip) return;
		at = { x: event.clientX, y: event.clientY };
		if (!frame) frame = requestAnimationFrame(place);
		const over = event.target instanceof Element && event.target.closest('section[aria-label="Timeline"]') ? "timeline" : null;
		if (over) chip.setAttribute("data-over", over);
		else chip.removeAttribute("data-over");
		const takes = event.defaultPrevented && event.dataTransfer?.dropEffect !== "none";
		if (takes) chip.removeAttribute("data-cannot");
		else chip.setAttribute("data-cannot", "");
	};
	const onDrop = () => {
		dropped = true;
	};
	const onDragEnd = (event: DragEvent) => {
		if (!chip) return;
		finish(dropped && event.dataTransfer?.dropEffect !== "none" ? "landed" : "back");
	};
	window.addEventListener("dragstart", onDragStart);
	window.addEventListener("dragover", onDragOver);
	window.addEventListener("drop", onDrop, true);
	window.addEventListener("dragend", onDragEnd, true);
	return () => {
		finish("back");
		window.removeEventListener("dragstart", onDragStart);
		window.removeEventListener("dragover", onDragOver);
		window.removeEventListener("drop", onDrop, true);
		window.removeEventListener("dragend", onDragEnd, true);
		style.remove();
	};
}

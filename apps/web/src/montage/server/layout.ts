// Layout guard for DeepSeek's layers (deterministic, after every plan): nothing on the face, nothing on the
// captions, everything inside the 9:16 safe zone. Blocks move above/below the face; when the only free place is
// the captions band, the captions give way (they start after a hook / end before a CTA).
import type { PlannedLayer } from "./plan";

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

const SAFE_TOP = 0.12;
const SAFE_BOTTOM = 0.7;
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Rough block extents (fractions of the frame) of a kit layer, from its props. */
function extent(l: PlannedLayer, aspect: number): { x0: number; x1: number; top: number; bottom: number } | null {
	const p = l.props;
	const y = num(p.y, NaN);
	const k = Math.min(1, aspect) / (9 / 16); // 1 for 9:16; smaller text share on wide frames
	const block = (h: number, w = 0.86, x = 0.5) => ({ x0: x - w / 2, x1: x + w / 2, top: y - h / 2, bottom: y + h / 2 });
	switch (l.kind) {
		case "HookTitle": {
			const text = str(p.text).replace(/\*/g, "");
			const size = num(p.size, 104) / 104;
			const lines = text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / (13 / size))), 0);
			return Number.isNaN(y) ? null : block((lines * 0.066 * size + (str(p.kicker) ? 0.04 : 0)) * k);
		}
		case "Plate":
			return Number.isNaN(y) ? null : block((str(p.sub) ? 0.11 : 0.075) * k, 0.8);
		case "Card":
			return Number.isNaN(y) ? null : block(0.1 * k, 0.8);
		case "Counter":
			return Number.isNaN(y) ? null : block((str(p.label) ? 0.17 : 0.12) * k, 0.7);
		case "PriceCard":
			return Number.isNaN(y) ? null : block(0.2 * k, 0.72);
		case "CTA":
			return Number.isNaN(y) ? null : block(0.065 * k, 0.75);
		case "Badge":
		case "Sticker": {
			const x = num(p.x, 0.78);
			const s = (l.kind === "Sticker" ? 0.1 : 0.12) * num(p.scale, 1) * k;
			return Number.isNaN(y) ? null : { x0: x - s * 0.9, x1: x + s * 0.9, top: y - s / 2, bottom: y + s / 2 };
		}
		case "LowerThird": {
			const x = num(p.x, 0.06);
			return Number.isNaN(y) ? null : { x0: x, x1: x + 0.5, top: y, bottom: y + 0.075 * k };
		}
	}
	return null;
}

const overlapsY = (a: { top: number; bottom: number }, b: { top: number; bottom: number }) => a.top < b.bottom && b.top < a.bottom;
const overlapsX = (a: { x0: number; x1: number }, b: { x0: number; x1: number }) => a.x0 < b.x1 && b.x0 < a.x1;
const overlapsT = (a: PlannedLayer, b: PlannedLayer) => a.from < b.to && b.from < a.to;

type Ext = { x0: number; x1: number; top: number; bottom: number };

const PRIORITY: Record<string, number> = { HookTitle: 0, LowerThird: 1, PriceCard: 2, Counter: 2, Card: 2, Plate: 2, Badge: 3, Sticker: 3, CTA: 9 };

/** Where the request put things ("hook at the top"): binding, the guard only searches inside that band. */
export type Pin = "top" | "center" | "bottom" | null;
const BANDS: Record<Exclude<Pin, null>, [number, number]> = { top: [0.05, 0.36], center: [0.3, 0.66], bottom: [0.52, 0.8] };

export function pinOf(request: string): Pin {
	const q = request.toLowerCase();
	if (/сверху|вверху|наверху|наверх|в верхн|top|upper|above/.test(q)) return "top";
	if (/снизу|внизу|в нижн|bottom|below/.test(q)) return "bottom";
	if (/по центру|в центре|посередин|центр|center|centre|middle/.test(q)) return "center";
	return null;
}

export function resolveLayout(layers: PlannedLayer[], face: Box | null, aspect: number, pin: Pin = null): string[] {
	const notes: string[] = [];
	const captions = layers.find((l) => l.kind === "Captions");
	if (captions && num(captions.props.y, 0.62) > 0.66) captions.props.y = 0.62;
	const capY = captions ? num(captions.props.y, 0.62) : 0;
	const band: Ext | null = captions ? { x0: 0.08, x1: 0.92, top: capY - 0.055, bottom: capY + 0.055 } : null;
	// The face plus a safe margin (forehead and chin included): nothing big may touch it.
	const faceBox: Ext | null = face ? { x0: face.x - 0.02, x1: face.x + face.w + 0.02, top: face.y - 0.035, bottom: face.y + face.h + 0.025 } : null;
	const placed: { l: PlannedLayer; e: Ext }[] = [];
	const hit = (a: Ext, b: Ext) => overlapsX(a, b) && overlapsY(a, b);
	const faceOverlap = (e: Ext) => (faceBox && overlapsX(e, faceBox) ? Math.max(0, Math.min(e.bottom, faceBox.bottom) - Math.max(e.top, faceBox.top)) : 0);
	const order = layers
		.filter((l) => l !== captions)
		.sort((a, b) => (PRIORITY[a.kind] ?? 5) - (PRIORITY[b.kind] ?? 5) || a.from - b.from);

	for (const l of order) {
		let e0 = extent(l, aspect);
		if (!e0) continue;
		// A position the user asked for wins: search only that band; a hook shrinks until it fits beside the face.
		const pinBand = pin && l.kind !== "Captions" ? BANDS[pin] : null;
		const lo = pinBand ? pinBand[0] : SAFE_TOP;
		const hi = pinBand ? pinBand[1] : SAFE_BOTTOM;
		if (pinBand) {
			if (e0.top < lo || e0.bottom > hi) {
				l.props.y = Math.round(Math.min(Math.max(num(l.props.y, 0.3), lo + (e0.bottom - e0.top) / 2), hi - (e0.bottom - e0.top) / 2) * 1000) / 1000;
				e0 = extent(l, aspect) ?? e0;
			}
			if (l.kind === "HookTitle" && faceBox) {
				const room = pin === "top" ? faceBox.top - lo : pin === "bottom" ? hi - faceBox.bottom : 1;
				for (let size = num(l.props.size, 104); size > 62 && e0.bottom - e0.top > room; size -= 6) {
					l.props.size = size - 6;
					e0 = extent(l, aspect) ?? e0;
				}
				if (l.props.size !== undefined) notes.push(`${l.kind} size ${l.props.size} to fit the ${pin}`);
			}
		}
		const h = e0.bottom - e0.top;
		const at = (top: number): Ext => ({ ...e0, top, bottom: top + h });
		const onLayers = (e: Ext) => placed.some((o) => overlapsT(o.l, l) && hit(e, o.e));
		const onCaptions = (e: Ext) => !!(band && captions && overlapsT(l, captions) && hit(e, band));
		const onFace = (e: Ext) => faceOverlap(e) > 0;
		const origin = Math.min(Math.max(e0.top, lo), Math.max(lo, hi - h));
		const tops: number[] = [];
		for (let t = lo; t <= hi - h + 1e-9; t += 0.005) tops.push(Math.round(t * 1000) / 1000);
		if (!tops.length) tops.push(Math.round(lo * 1000) / 1000);
		tops.sort((a, b) => Math.abs(a - origin) - Math.abs(b - origin));
		const canTrimCaptions = !!captions && (l.from <= captions.from + 0.6 || l.to >= captions.to - 0.6);

		let top = tops.find((t) => !onFace(at(t)) && !onLayers(at(t)) && !onCaptions(at(t)));
		let trim = false;
		if (top === undefined && canTrimCaptions) {
			top = tops.find((t) => !onFace(at(t)) && !onLayers(at(t)));
			trim = top !== undefined;
		}
		if (top === undefined) {
			// Nothing face-free: least face overlap, never on other layers; on the captions only if they can give way.
			const ok = tops.filter((t) => !onLayers(at(t)) && (canTrimCaptions || !onCaptions(at(t))));
			top = ok.sort((a, b) => faceOverlap(at(a)) - faceOverlap(at(b)) || Math.abs(a - origin) - Math.abs(b - origin))[0] ?? origin;
			trim = canTrimCaptions;
		}
		if (trim && captions && band && hit(at(top), band)) {
			if (l.from <= captions.from + 0.6) {
				captions.from = Math.min(captions.to - 0.3, Math.max(captions.from, l.to));
				notes.push(`captions start after the ${l.kind}`);
			} else {
				captions.to = Math.max(captions.from + 0.3, Math.min(captions.to, l.from));
				notes.push(`captions end before the ${l.kind}`);
			}
		}
		if (Math.abs(top - e0.top) > 1e-6) {
			l.props.y = Math.round((num(l.props.y, 0) + (top - e0.top)) * 1000) / 1000;
			notes.push(`${l.kind} moved to y ${l.props.y}`);
		}
		placed.push({ l, e: at(top) });
	}
	return notes;
}

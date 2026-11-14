// Draws a motion title's layers (text/design.ts) around the text on the same canvas, frame by frame: under the
// letters (plates, bars, lines, frames, icons inside plates), the second line, and over them (sparks, the cursor).
// Each layer runs its own entrance — a wipe, a pop, a slide, a stroke drawn on — and rewinds with the clip's exit.
import {
	boxOf,
	type DesignGeometry,
	type DesignLayer,
	type DesignState,
	fillOf,
	ICONS,
	inflate,
	type LayerMotion,
	layerProgress,
	type Rect,
	sincePress,
} from "./design";
import type { TextCanvasContext } from "./layout";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const spring = (t: number) => (t >= 1 ? 1 : 1 - Math.cos(t * Math.PI * 2.2) * Math.exp(-t * 6));
const hash = (n: number) => {
	const x = Math.sin(n * 91.7) * 47453.5453;
	return x - Math.floor(x);
};

const paths = new Map<string, Path2D>();
function iconPath(id: string): Path2D | null {
	const icon = ICONS[id];
	if (!icon || typeof Path2D === "undefined") return null;
	let path = paths.get(id);
	if (!path) {
		path = new Path2D(icon.d);
		paths.set(id, path);
	}
	return path;
}

function parseHex(color: string): [number, number, number, number] | null {
	const hex = color.trim().replace("#", "");
	if (!/^[0-9a-f]+$/i.test(hex)) return null;
	const full = hex.length <= 4 ? hex.split("").map((c) => c + c).join("") : hex;
	if (full.length !== 6 && full.length !== 8) return null;
	const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
	return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
}

/** a → b by t (hex colours; anything else switches half-way). */
export function mixColor(a: string, b: string, t: number): string {
	if (t <= 0) return a;
	if (t >= 1) return b;
	const x = parseHex(a);
	const y = parseHex(b);
	if (!x || !y) return t < 0.5 ? a : b;
	const c = x.map((v, i) => v + (y[i] - v) * t);
	return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${c[3].toFixed(3)})`;
}

/** How much the button gives under the press (1 = rest). */
export function pressScale(state: DesignState): number {
	const since = sincePress(state);
	if (since == null || since < 0 || since > 0.3) return 1;
	return 1 - 0.075 * Math.sin((Math.PI * since) / 0.3);
}

/** Runs `draw` inside a layer's entrance (a clip, a move, a scale, a fade); `draw` gets how much of a stroke to draw. */
function withMotion(ctx: TextCanvasContext, motion: LayerMotion | undefined, p: number, rect: Rect, em: number, draw: (part: number) => void, pivot?: { x: number; y: number }): void {
	if (p <= 0) return;
	if (!motion || p >= 1) {
		draw(1);
		return;
	}
	const cx = pivot?.x ?? rect.left + rect.width / 2;
	const cy = pivot?.y ?? rect.top + rect.height / 2;
	ctx.save();
	switch (motion.type) {
		case "wipeX":
		case "wipeXR":
		case "wipeY": {
			const e = easeOutCubic(p);
			const box = inflate(rect, em * 1.5, em * 1.5);
			ctx.beginPath();
			if (motion.type === "wipeX") ctx.rect(box.left, box.top, em * 1.5 + rect.width * e, box.height);
			else if (motion.type === "wipeXR") ctx.rect(rect.left + rect.width * (1 - e), box.top, rect.width * e + em * 1.5, box.height);
			else ctx.rect(box.left, rect.top + rect.height * (1 - e), box.width, rect.height * e + em * 1.5);
			ctx.clip();
			draw(1);
			break;
		}
		case "grow": {
			const e = easeOutCubic(p);
			ctx.globalAlpha *= e;
			ctx.translate(cx, cy);
			ctx.scale(0.86 + 0.14 * e, 0.86 + 0.14 * e);
			ctx.translate(-cx, -cy);
			draw(1);
			break;
		}
		case "pop":
		case "spin": {
			const s = Math.max(0.001, spring(p));
			ctx.globalAlpha *= clamp01(p * 4);
			ctx.translate(cx, cy);
			if (motion.type === "spin") ctx.rotate(((1 - easeOutCubic(p)) * -110 * Math.PI) / 180);
			ctx.scale(s, s);
			ctx.translate(-cx, -cy);
			draw(1);
			break;
		}
		case "swing": {
			// A tag on a nail: falls in from a turn and settles with a swing.
			const angle = -16 * Math.cos(p * Math.PI * 2.4) * Math.exp(-p * 4.5);
			ctx.globalAlpha *= clamp01(p * 5);
			const px = rect.left + rect.height * 0.32;
			ctx.translate(px, cy);
			ctx.rotate((angle * Math.PI) / 180);
			ctx.translate(-px, -cy);
			draw(1);
			break;
		}
		case "slideX":
		case "slideY": {
			const e = easeOutExpo(p);
			const from = (motion.from ?? (motion.type === "slideX" ? -0.6 : 0.5)) * em;
			ctx.globalAlpha *= clamp01(p * 2.5);
			ctx.translate(motion.type === "slideX" ? (1 - e) * from : 0, motion.type === "slideY" ? (1 - e) * from : 0);
			draw(1);
			break;
		}
		case "fade":
			ctx.globalAlpha *= easeOutCubic(p);
			draw(1);
			break;
		case "draw":
			draw(easeInOutCubic(p));
			break;
	}
	ctx.restore();
}

function setShadow(ctx: TextCanvasContext, color: string, blur: number, offsetY: number, pixelScale: number) {
	ctx.shadowColor = color;
	ctx.shadowBlur = blur * pixelScale;
	ctx.shadowOffsetX = 0;
	ctx.shadowOffsetY = offsetY * pixelScale;
}

function paintOf(ctx: TextCanvasContext, a: string, b: string | undefined, rect: Rect, vertical = false): string | CanvasGradient {
	if (!b) return a;
	const gradient = vertical ? ctx.createLinearGradient(0, rect.top, 0, rect.top + rect.height) : ctx.createLinearGradient(rect.left, 0, rect.left + rect.width, 0);
	gradient.addColorStop(0, a);
	gradient.addColorStop(1, b);
	return gradient;
}

function starPath(ctx: TextCanvasContext, cx: number, cy: number, outer: number, inner: number, points: number, turn: number) {
	ctx.beginPath();
	for (let i = 0; i < points * 2; i++) {
		const r = i % 2 === 0 ? outer : inner;
		const a = turn + (i * Math.PI) / points - Math.PI / 2;
		const x = cx + Math.cos(a) * r;
		const y = cy + Math.sin(a) * r;
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	ctx.closePath();
}

function drawPlate(ctx: TextCanvasContext, layer: Extract<DesignLayer, { kind: "plate" }>, geometry: DesignGeometry, state: DesignState, pixelScale: number) {
	const em = geometry.fontPx;
	const [px, py] = layer.pad ?? [0, 0];
	let rect = inflate(boxOf(geometry, layer.around), px * em, py * em);
	if (layer.offset) rect = { ...rect, left: rect.left + layer.offset[0] * em, top: rect.top + layer.offset[1] * em };
	const since = sincePress(state);
	let fill = fillOf(layer.fill, state);
	if (layer.pressed && since != null && since > 0) fill = mixColor(fill, fillOf(layer.pressed, state), clamp01(since / 0.18));
	const fill2 = layer.fill2 ? fillOf(layer.fill2, state) : undefined;
	const cx = rect.left + rect.width / 2;
	const cy = rect.top + rect.height / 2;
	const p = layerProgress(layer.motion, state);
	withMotion(ctx, layer.motion, p, rect, em, () => {
		ctx.save();
		if (layer.rotate || layer.skew) {
			ctx.translate(cx, cy);
			if (layer.rotate) ctx.rotate((layer.rotate * Math.PI) / 180);
			if (layer.skew) ctx.transform(1, 0, -layer.skew, 1, 0, 0);
			ctx.translate(-cx, -cy);
		}
		if (layer.glow) setShadow(ctx, fill, layer.glow * em, 0, pixelScale);
		else if (layer.shadow) setShadow(ctx, "rgba(0, 0, 0, 0.34)", em * 0.55, em * 0.16, pixelScale);
		const shape = layer.shape ?? "rect";
		ctx.fillStyle = paintOf(ctx, fill, fill2, rect, shape === "sun");
		if (shape === "circle" || shape === "burst" || shape === "sun") {
			const r = Math.max(rect.width, rect.height) / 2;
			if (shape === "burst") {
				starPath(ctx, cx, cy, r * 1.04, r * 0.86, 16, (state.t * (layer.spin ?? 0) * Math.PI) / 180);
				ctx.fill();
			} else if (shape === "circle") {
				ctx.beginPath();
				ctx.arc(cx, cy, r, 0, Math.PI * 2);
				ctx.fill();
			} else {
				// A synthwave sun: a disc whose lower half is cut by widening gaps.
				ctx.beginPath();
				ctx.arc(cx, cy, r, 0, Math.PI * 2);
				ctx.clip();
				ctx.shadowColor = "transparent";
				ctx.fillStyle = paintOf(ctx, fill, fill2, { left: cx - r, top: cy - r, width: 2 * r, height: 2 * r }, true);
				ctx.fillRect(cx - r, cy - r, 2 * r, r * 1.08);
				let y = cy + r * 0.08;
				for (let band = 0; band < 6 && y < cy + r; band++) {
					const gap = r * (0.035 + band * 0.022);
					const height = r * (0.17 - band * 0.018);
					y += gap;
					ctx.fillRect(cx - r, y, 2 * r, Math.max(1, height));
					y += height;
				}
			}
		} else {
			const radius = Math.min((layer.radius ?? 0) * em, rect.height / 2, rect.width / 2);
			ctx.beginPath();
			if (shape === "tag") {
				const notch = rect.height * 0.42;
				const l = rect.left - notch * 0.6;
				ctx.moveTo(l + notch, rect.top);
				ctx.arcTo(rect.left + rect.width, rect.top, rect.left + rect.width, rect.top + rect.height, radius);
				ctx.arcTo(rect.left + rect.width, rect.top + rect.height, l, rect.top + rect.height, radius);
				ctx.lineTo(l + notch, rect.top + rect.height);
				ctx.lineTo(l, cy);
				ctx.closePath();
				ctx.moveTo(l + notch * 0.62 + rect.height * 0.08, cy);
				ctx.arc(l + notch * 0.62, cy, rect.height * 0.08, 0, Math.PI * 2, true);
			} else if (shape === "ribbon") {
				const notch = rect.height * 0.32;
				ctx.moveTo(rect.left, rect.top);
				ctx.lineTo(rect.left + rect.width, rect.top);
				ctx.lineTo(rect.left + rect.width - notch, cy);
				ctx.lineTo(rect.left + rect.width, rect.top + rect.height);
				ctx.lineTo(rect.left, rect.top + rect.height);
				ctx.lineTo(rect.left + notch, cy);
				ctx.closePath();
			} else if (shape === "marker") {
				// A highlighter stroke: slightly uneven ends.
				const w = rect.width;
				const h = rect.height;
				ctx.moveTo(rect.left + h * 0.1, rect.top + h * 0.06);
				ctx.quadraticCurveTo(rect.left + w * 0.5, rect.top - h * 0.05, rect.left + w - h * 0.04, rect.top + h * 0.1);
				ctx.quadraticCurveTo(rect.left + w + h * 0.06, cy, rect.left + w - h * 0.1, rect.top + h * 0.96);
				ctx.quadraticCurveTo(rect.left + w * 0.5, rect.top + h * 1.04, rect.left + h * 0.04, rect.top + h * 0.92);
				ctx.quadraticCurveTo(rect.left - h * 0.08, cy, rect.left + h * 0.1, rect.top + h * 0.06);
			} else {
				ctx.roundRect(rect.left, rect.top, rect.width, rect.height, radius);
				if (shape === "bubble") {
					const base = rect.left + Math.min(rect.width * 0.3, em * 1.4);
					ctx.moveTo(base, rect.top + rect.height - 1);
					ctx.lineTo(base - em * 0.35, rect.top + rect.height + em * 0.55);
					ctx.lineTo(base + em * 0.55, rect.top + rect.height - 1);
					ctx.closePath();
				}
			}
			ctx.fill(shape === "tag" ? "evenodd" : "nonzero");
			if (layer.stroke) {
				ctx.shadowColor = "transparent";
				ctx.strokeStyle = fillOf(layer.stroke, state);
				ctx.lineWidth = (layer.strokeWidth ?? 0.04) * em;
				ctx.stroke();
			}
		}
		ctx.restore();
	});
}

function drawBar(ctx: TextCanvasContext, layer: Extract<DesignLayer, { kind: "bar" }>, geometry: DesignGeometry, state: DesignState) {
	const em = geometry.fontPx;
	const box = boxOf(geometry, layer.around);
	const size = layer.size * em;
	const gap = layer.gap * em;
	const ext = (layer.extend ?? 0) * em;
	const rect =
		layer.side === "left"
			? { left: box.left - gap - size, top: box.top - ext, width: size, height: box.height + 2 * ext }
			: layer.side === "right"
				? { left: box.left + box.width + gap, top: box.top - ext, width: size, height: box.height + 2 * ext }
				: layer.side === "top"
					? { left: box.left - ext, top: box.top - gap - size, width: box.width + 2 * ext, height: size }
					: { left: box.left - ext, top: box.top + box.height + gap, width: box.width + 2 * ext, height: size };
	withMotion(ctx, layer.motion, layerProgress(layer.motion, state), rect, em, () => {
		ctx.fillStyle = fillOf(layer.fill, state);
		ctx.beginPath();
		ctx.roundRect(rect.left, rect.top, rect.width, rect.height, Math.min(rect.width, rect.height) / 2);
		ctx.fill();
	});
}

function drawLine(ctx: TextCanvasContext, layer: Extract<DesignLayer, { kind: "line" }>, geometry: DesignGeometry, state: DesignState, align: string, pixelScale: number) {
	const em = geometry.fontPx;
	const box = boxOf(geometry, layer.around);
	const size = layer.size * em;
	const color = fillOf(layer.fill, state);
	const p = layerProgress(layer.motion, state);
	if (p <= 0) return;
	const part = layer.motion?.type === "wipeX" || layer.motion?.type === "draw" ? easeOutCubic(p) : 1;
	ctx.save();
	if (layer.glow) setShadow(ctx, color, layer.glow * em, 0, pixelScale);
	if (layer.motion?.type === "fade" || layer.motion?.type === "slideY") ctx.globalAlpha *= easeOutCubic(p);
	ctx.fillStyle = color;
	ctx.strokeStyle = color;
	if (layer.at === "flank") {
		const length = (layer.length ?? 1) * em * part;
		const y = geometry.main.top + geometry.main.height / 2 - size / 2;
		const gap = layer.gap * em;
		ctx.fillRect(box.left - gap - length, y, length, size);
		ctx.fillRect(box.left + box.width + gap, y, length, size);
		ctx.restore();
		return;
	}
	const width = box.width * (layer.length ?? 1);
	const left = align === "left" ? box.left : align === "right" ? box.left + box.width - width : box.left + (box.width - width) / 2;
	let y: number;
	if (layer.at === "between" && geometry.sub) {
		const subBelow = geometry.sub.top >= geometry.main.top + geometry.main.height - 1;
		y = subBelow ? (geometry.main.top + geometry.main.height + geometry.sub.top) / 2 : (geometry.sub.top + geometry.sub.height + geometry.main.top) / 2;
	} else if (layer.at === "over") y = box.top - layer.gap * em;
	else y = (layer.at === "between" ? geometry.main.top + geometry.main.height : box.top + box.height) + layer.gap * em;
	// Lines grow from the side the text is aligned to (from the middle when centred).
	const grownLeft = align === "left" ? left : align === "right" ? left + width * (1 - part) : left + (width * (1 - part)) / 2;
	if (layer.wave) {
		ctx.lineWidth = size;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.beginPath();
		const end = left + width * part;
		for (let x = left; x <= end; x += Math.max(1, em * 0.05)) {
			const yy = y + Math.sin(((x - left) / (em * 0.9)) * Math.PI * 2) * em * 0.07 + ((x - left) / width) * em * 0.06;
			if (x === left) ctx.moveTo(x, yy);
			else ctx.lineTo(x, yy);
		}
		ctx.stroke();
	} else {
		ctx.beginPath();
		ctx.roundRect(grownLeft, y - size / 2, width * part, size, size / 2);
		ctx.fill();
	}
	ctx.restore();
}

function drawFrame(ctx: TextCanvasContext, layer: Extract<DesignLayer, { kind: "frame" }>, geometry: DesignGeometry, state: DesignState, pixelScale: number) {
	const em = geometry.fontPx;
	const rect = inflate(boxOf(geometry, layer.around), layer.pad[0] * em, layer.pad[1] * em);
	const color = fillOf(layer.color, state);
	const p = layerProgress(layer.motion, state);
	if (p <= 0) return;
	if (layer.flicker) {
		const window = 0.9 * state.k;
		if (state.t < window && hash(Math.floor(state.t * 22)) < 0.42 * (1 - state.t / window)) return;
	}
	ctx.save();
	ctx.strokeStyle = color;
	ctx.lineWidth = layer.size * em;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	if (layer.glow) setShadow(ctx, color, layer.glow * em, 0, pixelScale);
	const part = layer.motion?.type === "draw" ? easeInOutCubic(p) : 1;
	if (layer.motion && layer.motion.type !== "draw") ctx.globalAlpha *= easeOutCubic(p);
	if (layer.corners) {
		const arm = Math.min(rect.width, rect.height) * layer.corners * part;
		const r = rect.left + rect.width;
		const b = rect.top + rect.height;
		ctx.beginPath();
		for (const [x, y, sx, sy] of [
			[rect.left, rect.top, 1, 1],
			[r, rect.top, -1, 1],
			[r, b, -1, -1],
			[rect.left, b, 1, -1],
		] as const) {
			ctx.moveTo(x + sx * arm, y);
			ctx.lineTo(x, y);
			ctx.lineTo(x, y + sy * arm);
		}
		ctx.stroke();
	} else {
		const radius = Math.min((layer.radius ?? 0) * em, rect.height / 2, rect.width / 2);
		const perimeter = layer.round ? Math.PI * Math.max(rect.width, rect.height) : 2 * (rect.width + rect.height) + (layer.tail ? em * 2 : 0);
		ctx.beginPath();
		if (layer.round) ctx.arc(rect.left + rect.width / 2, rect.top + rect.height / 2, Math.max(rect.width, rect.height) / 2, -Math.PI / 2, Math.PI * 1.5);
		else ctx.roundRect(rect.left, rect.top, rect.width, rect.height, radius);
		if (layer.tail) {
			const base = rect.left + Math.min(rect.width * 0.25, em * 1.2);
			ctx.moveTo(base, rect.top + rect.height);
			ctx.lineTo(base - em * 0.3, rect.top + rect.height + em * 0.55);
			ctx.lineTo(base + em * 0.5, rect.top + rect.height);
		}
		if (part < 1) ctx.setLineDash([perimeter * part, perimeter]);
		ctx.stroke();
	}
	ctx.restore();
}

function drawIcon(ctx: TextCanvasContext, layer: Extract<DesignLayer, { kind: "icon" }>, geometry: DesignGeometry, state: DesignState) {
	const rect = geometry.icons.get(layer);
	// The clip's own icon replaces the design's first one (a second, like the arrow under a link, stays).
	const first = state.spec.layers.find((l) => l.kind === "icon") === layer;
	const id = (first && state.icon) || layer.icon || "star";
	const path = iconPath(id);
	if (!rect || !path) return;
	const em = geometry.fontPx;
	const p = layerProgress(layer.motion, state);
	const cx = rect.left + rect.width / 2;
	const cy = rect.top + rect.height / 2;
	withMotion(ctx, layer.motion, p, rect, em, () => {
		ctx.save();
		if (layer.bob && p >= 1) ctx.translate(0, Math.sin(state.t * Math.PI * 2 * 1.3) * em * 0.12);
		const since = sincePress(state);
		if (layer.ring && since != null && since > 0 && since < 1.6) {
			ctx.translate(cx, rect.top);
			ctx.rotate(((Math.sin(since * 26) * 22 * Math.exp(-since * 3.2)) * Math.PI) / 180);
			ctx.translate(-cx, -rect.top);
		}
		let size = rect.width;
		if (layer.disc) {
			ctx.fillStyle = fillOf(layer.disc, state);
			ctx.beginPath();
			ctx.arc(cx, cy, rect.width / 2, 0, Math.PI * 2);
			ctx.fill();
			size *= 0.6;
		}
		const scale = size / 24;
		ctx.translate(cx - size / 2, cy - size / 2);
		ctx.scale(scale, scale);
		const color = fillOf(layer.color, state);
		if (ICONS[id]?.stroke) {
			ctx.strokeStyle = color;
			ctx.lineWidth = 2.4;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			ctx.stroke(path);
		} else {
			ctx.fillStyle = color;
			ctx.fill(path, "evenodd");
		}
		ctx.restore();
	});
}

function drawCallout(ctx: TextCanvasContext, layer: Extract<DesignLayer, { kind: "callout" }>, geometry: DesignGeometry, state: DesignState) {
	const em = geometry.fontPx;
	const main = geometry.main;
	const p = layerProgress(layer.motion, state);
	if (p <= 0) return;
	const anchor = { x: main.left + layer.dx * em, y: main.top + main.height + layer.dy * em };
	const elbow = { x: main.left - em * 0.15, y: main.top + main.height + em * 0.18 };
	const end = { x: main.left + main.width, y: elbow.y };
	const color = fillOf(layer.color, state);
	ctx.save();
	ctx.fillStyle = color;
	ctx.strokeStyle = color;
	// the dot pops first, then the line runs to the text and under it
	const dot = spring(clamp01(p / 0.3));
	ctx.beginPath();
	ctx.arc(anchor.x, anchor.y, em * 0.17 * Math.max(0, dot), 0, Math.PI * 2);
	ctx.fill();
	const pulse = (state.t * 0.9) % 1;
	ctx.globalAlpha *= 0.45 * (1 - pulse) * clamp01(p * 3);
	ctx.lineWidth = em * 0.05;
	ctx.beginPath();
	ctx.arc(anchor.x, anchor.y, em * (0.2 + 0.35 * pulse), 0, Math.PI * 2);
	ctx.stroke();
	ctx.restore();
	const part = easeInOutCubic(clamp01((p - 0.15) / 0.85));
	if (part <= 0) return;
	const first = Math.hypot(elbow.x - anchor.x, elbow.y - anchor.y);
	const second = end.x - elbow.x;
	let left = (first + second) * part;
	ctx.save();
	ctx.strokeStyle = color;
	ctx.lineWidth = layer.size * em;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.beginPath();
	ctx.moveTo(anchor.x, anchor.y);
	const a = Math.min(1, left / first);
	ctx.lineTo(anchor.x + (elbow.x - anchor.x) * a, anchor.y + (elbow.y - anchor.y) * a);
	left -= first;
	if (left > 0) ctx.lineTo(elbow.x + Math.min(second, left), elbow.y);
	ctx.stroke();
	ctx.restore();
}

function drawSparks(ctx: TextCanvasContext, layer: Extract<DesignLayer, { kind: "sparks" }>, geometry: DesignGeometry, state: DesignState) {
	const em = geometry.fontPx;
	const raw = layer.motion ? (state.t - layer.motion.delay * state.k) / Math.max(0.01, layer.motion.dur * state.k) : 1;
	if (raw <= 0 || raw >= 1) return;
	const origin = layer.fromIcon ? [...geometry.icons.values()][0] : undefined;
	const box = origin ?? geometry.all;
	const cx = box.left + box.width / 2;
	const cy = box.top + box.height / 2;
	const reach = layer.spread * em + (origin ? 0 : Math.max(box.width, box.height) * 0.45);
	const e = easeOutCubic(raw);
	ctx.save();
	ctx.fillStyle = fillOf(layer.color, state);
	ctx.globalAlpha *= 1 - raw;
	for (let i = 0; i < layer.count; i++) {
		const angle = (i / layer.count) * Math.PI * 2 + 0.35 + hash(i) * 0.3;
		const distance = reach * (0.55 + 0.45 * hash(i + 9)) * e;
		const x = cx + Math.cos(angle) * distance;
		const y = cy + Math.sin(angle) * distance;
		const r = em * (0.1 + 0.06 * hash(i + 3)) * (1 - raw * 0.6);
		starPath(ctx, x, y, r * 1.6, r * 0.45, 4, angle);
		ctx.fill();
	}
	ctx.restore();
}

function drawCursor(ctx: TextCanvasContext, layer: Extract<DesignLayer, { kind: "cursor" }>, geometry: DesignGeometry, state: DesignState) {
	const since = sincePress(state);
	const path = iconPath("cursor");
	if (since == null || !path || !layer.motion) return;
	const em = geometry.fontPx;
	const start = layer.motion.delay * state.k;
	const pressAt = (state.spec.pressAt ?? 1) * state.k;
	if (state.t < start || since > 0.9) return;
	const target = { x: geometry.all.left + geometry.all.width - em * 0.9, y: geometry.all.top + geometry.all.height * 0.72 };
	const travel = easeInOutCubic(clamp01((state.t - start) / Math.max(0.05, pressAt - start - 0.04)));
	const x = target.x + layer.from[0] * em * (1 - travel);
	const y = target.y + layer.from[1] * em * (1 - travel);
	const fadeIn = clamp01((state.t - start) / 0.15);
	const fadeOut = since > 0.55 ? 1 - clamp01((since - 0.55) / 0.3) : 1;
	const click = since >= 0 && since < 0.25 ? 1 - 0.18 * Math.sin((Math.PI * since) / 0.25) : 1;
	ctx.save();
	if (since >= 0 && since < 0.5) drawRipple(ctx, target.x, target.y, em, since);
	ctx.globalAlpha *= fadeIn * fadeOut;
	const size = em * 1.25 * click;
	const scale = size / 24;
	// the tip of the arrow (5.2, 2.8 on its grid) is the point that presses
	ctx.translate(x - 5.2 * scale, y - 2.8 * scale);
	ctx.scale(scale, scale);
	ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
	ctx.shadowBlur = 3;
	ctx.shadowOffsetY = 1;
	ctx.fillStyle = fillOf(layer.color, state);
	ctx.fill(path);
	ctx.shadowColor = "transparent";
	ctx.strokeStyle = "#111111";
	ctx.lineWidth = 1.3;
	ctx.lineJoin = "round";
	ctx.stroke(path);
	ctx.restore();
}

/** The press ripple: a white disc growing out of the pressed point and fading, in its own save/restore. */
export function drawRipple(ctx: TextCanvasContext, x: number, y: number, em: number, since: number): void {
	const u = Math.min(1, Math.max(0, since / 0.5));
	ctx.save();
	ctx.globalAlpha *= 0.5 * (1 - u);
	ctx.fillStyle = "#ffffff";
	ctx.beginPath();
	ctx.arc(x, y, em * (0.2 + 1.1 * u), 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

/** The layers on one side of the letters (`over` = above them), in the design's order. */
export function drawDesignLayers({
	ctx,
	geometry,
	state,
	over,
	align,
	pixelScale,
	only,
}: {
	ctx: TextCanvasContext;
	geometry: DesignGeometry;
	state: DesignState;
	over: boolean;
	align: string;
	pixelScale: number;
	/** Draw just these kinds (the cursor stays out of the press). */
	only?: DesignLayer["kind"][];
}): void {
	for (const layer of state.spec.layers) {
		if (Boolean(layer.over) !== over) continue;
		if (only && !only.includes(layer.kind)) continue;
		if (!only && layer.kind === "cursor") continue;
		ctx.save();
		switch (layer.kind) {
			case "plate":
				drawPlate(ctx, layer, geometry, state, pixelScale);
				break;
			case "bar":
				drawBar(ctx, layer, geometry, state);
				break;
			case "line":
				drawLine(ctx, layer, geometry, state, align, pixelScale);
				break;
			case "frame":
				drawFrame(ctx, layer, geometry, state, pixelScale);
				break;
			case "icon":
				drawIcon(ctx, layer, geometry, state);
				break;
			case "callout":
				drawCallout(ctx, layer, geometry, state);
				break;
			case "sparks":
				drawSparks(ctx, layer, geometry, state);
				break;
			case "cursor":
				drawCursor(ctx, layer, geometry, state);
				break;
		}
		ctx.restore();
	}
}

/** The second line (a job title, a caption under a number), with its own entrance. */
export function drawSubText({ ctx, geometry, state }: { ctx: TextCanvasContext; geometry: DesignGeometry; state: DesignState }): void {
	const spec = state.spec.sub;
	const sub = geometry.sub;
	if (!spec || !sub || geometry.subLines.length === 0) return;
	const p = layerProgress(spec.motion, state);
	withMotion(ctx, spec.motion, p, sub, geometry.fontPx, () => {
		ctx.save();
		ctx.font = geometry.subFont;
		if ("letterSpacing" in ctx) (ctx as { letterSpacing: string }).letterSpacing = `${geometry.subTracking}px`;
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.shadowColor = "transparent";
		const color = fillOf(spec.color ?? "sub", state);
		ctx.fillStyle = color;
		const lineHeight = geometry.subPx * 1.25;
		geometry.subLines.forEach((line, index) => {
			const align = spec.align ?? "center";
			const x = align === "left" ? sub.left : align === "right" ? sub.left + sub.width - line.width : sub.left + (sub.width - line.width) / 2;
			const y = sub.top + lineHeight * (index + 0.5);
			ctx.fillText(line.text, x, y);
			if (spec.strike) ctx.fillRect(x - geometry.subPx * 0.05, y - geometry.subPx * 0.05, line.width + geometry.subPx * 0.1, Math.max(1, geometry.subPx * 0.09));
		});
		ctx.restore();
	});
}

/** Copies of the letters behind them (echo, stack, hard shadow): offset in px, colour, outline, opacity. */
export function echoCopies(geometry: DesignGeometry, state: DesignState): { dx: number; dy: number; color: string; outline: boolean; alpha: number }[] {
	const copies: { dx: number; dy: number; color: string; outline: boolean; alpha: number }[] = [];
	const em = geometry.fontPx;
	for (const layer of state.spec.layers) {
		if (layer.kind !== "echo") continue;
		const p = layerProgress(layer.motion, state);
		if (p <= 0) continue;
		const e = easeOutExpo(p);
		for (let j = layer.count; j >= 1; j--) {
			const color = fillOf(layer.colors[(j - 1) % layer.colors.length], state);
			const alpha = (layer.outline ? 0.7 - 0.25 * (j - 1) : 1) * clamp01(p * 2);
			const offsets = layer.mirror ? [1, -1] : [1];
			for (const sign of offsets) copies.push({ dx: layer.dx * j * em * e * sign, dy: layer.dy * j * em * e * sign, color, outline: Boolean(layer.outline), alpha });
		}
	}
	return copies;
}

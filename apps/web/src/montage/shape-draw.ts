// Drawing a layer on the player inside a composition (Figma / After Effects): a press-drag with a shape tool draws
// it at that place and size (Shift: a square / circle, a line at 45° steps); a plain click puts a default-size one
// centred there. Points are canvas px (0…width, 0…height); the result is the layer's transform params. A shape
// (graphic) at scale 1 is a square of the canvas's short side (layers.ts → shapeBase), so size = scale × base.
// Pure: no editor core, no DOM.

export type DrawTool = "select" | "rect" | "rounded" | "circle" | "line" | "text";
export type ShapeTool = Exclude<DrawTool, "select" | "text">;

export interface Point {
	x: number;
	y: number;
}

export interface DrawnTransform {
	"transform.positionX": number;
	"transform.positionY": number;
	"transform.scaleX": number;
	"transform.scaleY": number;
	"transform.rotate": number;
}

type Canvas = { width: number; height: number };

/** The same as layers.ts → shapeBase (kept here so this file imports nothing). */
const shapeBase = (canvas: Canvas) => Math.min(canvas.width, canvas.height);

/** A press that moved less than this (canvas px) is a click, not a drag. */
export const CLICK_SLOP = 3;

/** A line is a thin bar: ~6 px on a 1080 px frame. */
export const lineThickness = (canvas: Canvas) => Math.max(2, Math.round(shapeBase(canvas) * 0.006));

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

function place(canvas: Canvas, cx: number, cy: number, w: number, h: number, rot = 0): DrawnTransform {
	const base = shapeBase(canvas);
	return {
		"transform.positionX": Math.round(cx - canvas.width / 2),
		"transform.positionY": Math.round(cy - canvas.height / 2),
		"transform.scaleX": round(Math.max(1, w) / base),
		"transform.scaleY": round(Math.max(1, h) / base),
		"transform.rotate": round(rot, 2),
	};
}

/** The box a drag from `a` to `b` spans; with Shift its sides are equal (the larger one), growing from `a`. */
export function dragBox(a: Point, b: Point, shift: boolean): { x: number; y: number; w: number; h: number } {
	let dx = b.x - a.x;
	let dy = b.y - a.y;
	if (shift) {
		const side = Math.max(Math.abs(dx), Math.abs(dy));
		dx = (dx < 0 ? -1 : 1) * side;
		dy = (dy < 0 ? -1 : 1) * side;
	}
	return { x: Math.min(a.x, a.x + dx), y: Math.min(a.y, a.y + dy), w: Math.abs(dx), h: Math.abs(dy) };
}

/** The end of a line drawn from `a` to `b`; with Shift it turns to the nearest 45°. */
export function lineEnd(a: Point, b: Point, shift: boolean): Point {
	if (!shift) return b;
	const len = Math.hypot(b.x - a.x, b.y - a.y);
	const step = Math.PI / 4;
	const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / step) * step;
	return { x: a.x + len * Math.cos(ang), y: a.y + len * Math.sin(ang) };
}

/** The transform of a shape drawn by a drag; null when the press barely moved (a click: see `shapeAtPoint`). */
export function shapeFromDrag(tool: ShapeTool, a: Point, b: Point, shift: boolean, canvas: Canvas): DrawnTransform | null {
	if (Math.hypot(b.x - a.x, b.y - a.y) < CLICK_SLOP) return null;
	if (tool === "line") {
		const end = lineEnd(a, b, shift);
		const len = Math.hypot(end.x - a.x, end.y - a.y);
		const rot = (Math.atan2(end.y - a.y, end.x - a.x) * 180) / Math.PI;
		return place(canvas, (a.x + end.x) / 2, (a.y + end.y) / 2, len, lineThickness(canvas), rot);
	}
	const box = dragBox(a, b, shift);
	return place(canvas, box.x + box.w / 2, box.y + box.h / 2, box.w, box.h);
}

/** A click with a shape tool: a default-size shape centred at the point (a fifth of the frame's short side). */
export function shapeAtPoint(tool: ShapeTool, at: Point, canvas: Canvas): DrawnTransform {
	const base = shapeBase(canvas);
	if (tool === "line") return place(canvas, at.x, at.y, base * 0.4, lineThickness(canvas));
	if (tool === "circle") return place(canvas, at.x, at.y, base * 0.25, base * 0.25);
	return place(canvas, at.x, at.y, base * 0.4, base * 0.25);
}

/** A click with the Text tool: the text's centre goes there. */
export function textAtPoint(at: Point, canvas: Canvas): Pick<DrawnTransform, "transform.positionX" | "transform.positionY"> {
	return { "transform.positionX": Math.round(at.x - canvas.width / 2), "transform.positionY": Math.round(at.y - canvas.height / 2) };
}

/** The point clamped into the frame (a drag that leaves the picture stops at its edge). */
export const clampToCanvas = (p: Point, canvas: Canvas): Point => ({ x: Math.min(canvas.width, Math.max(0, p.x)), y: Math.min(canvas.height, Math.max(0, p.y)) });

// Editing tools Claude has on top of Gaziyav AI's: clip order on the main track, keyframes (the inspector's diamond),
// each one ⌘Z step.
import { EditorCore } from "@/core";
import type { AnimationInterpolation } from "@/animation/types";
import { getElementParam, getElementParams } from "@/params/registry";
import type { TimelineElement, TimelineTrack } from "@/timeline";
import { reorderMainTrack } from "@/timeline/main-order";
import { mediaTimeFromSeconds, TICKS_PER_SECOND } from "@/wasm";

type Args = Record<string, unknown>;

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

export const EDIT_TOOL_SPECS = [
	{
		name: "reorder",
		description: "Change the order of clips on the main video track: put a clip at position `index` (0 = first); the track stays packed back to back, like dragging it in the timeline. One ⌘Z.",
		parameters: obj({ id: { type: "string", description: "Clip id on the main track" }, index: { type: "number", description: "New position, 0-based" } }, ["id", "index"]),
	},
	{
		name: "keyframes",
		description:
			"Animate one parameter of an element with keyframes: `points` are timeline seconds with the value at each (the inspector's diamonds; one ⌘Z). Keys as get_element lists them, e.g. transform.positionX / transform.positionY (px from the canvas centre), transform.scale (both axes) or transform.scaleX, transform.rotate (degrees), opacity (0–1), volume (dB). interpolation: bezier (eased, default), linear or hold. remove:true deletes that parameter's keyframes.",
		parameters: obj(
			{
				id: { type: "string", description: "Element id" },
				key: { type: "string", description: "Parameter key" },
				points: {
					type: "array",
					items: obj({ time: { type: "number", description: "Timeline seconds" }, value: { type: "number" } }, ["time", "value"]),
					description: "Keyframes",
				},
				interpolation: { type: "string", description: "bezier | linear | hold" },
				remove: { type: "boolean", description: "Remove this parameter's keyframes" },
			},
			["id", "key"],
		),
	},
];

EDIT_TOOL_SPECS.push({
	name: "camera",
	description: "A named camera move on a clip as keyframes: push_in, pull_out, pan_left, pan_right, tilt_up, tilt_down, ken_burns, shake, punch_in (amount 0.02–0.6, from/to timeline seconds). One ⌘Z.",
	parameters: obj({ id: { type: "string", description: "Clip id" }, move: { type: "string", description: "The move" }, amount: { type: "number", description: "How far, 0.1 = 10 %" }, from: { type: "number", description: "Seconds" }, to: { type: "number", description: "Seconds" } }, ["id", "move"]),
});

export const EDIT_TOOL_NAMES = new Set(EDIT_TOOL_SPECS.map((t) => t.name));

const editor = () => EditorCore.getInstance();

function findElement(id: unknown): { track: TimelineTrack; element: TimelineElement } {
	const key = String(id ?? "").trim();
	if (!key) throw new Error("Give the element id (from get_project).");
	const t = editor().scenes.getActiveScene().tracks;
	for (const track of [...t.overlay, t.main, ...t.audio] as TimelineTrack[]) {
		for (const element of track.elements as TimelineElement[]) {
			if (element.id === key || element.id.startsWith(key)) return { track, element };
		}
	}
	throw new Error(`No element "${key}" on the timeline. Call get_project for the current ids.`);
}

export function runEditTool(name: string, args: Args): string {
	if (name === "reorder") {
		const key = String(args.id ?? "");
		const clip = (editor().scenes.getActiveScene().tracks.main.elements as TimelineElement[]).find((e) => e.id === key || e.id.startsWith(key));
		if (!key || !clip) throw new Error(`No clip "${key}" on the main track. Call get_project.`);
		const order = reorderMainTrack(editor(), clip.id, Number(args.index) || 0);
		return `Order now: ${order.map((e) => e.name).join(" → ")}.`;
	}
	if (name === "camera") return cameraMove(args);
	if (name !== "keyframes") throw new Error(`Unknown tool ${name}.`);
	const { track, element } = findElement(args.id);
	const key = String(args.key ?? "");
	const paths = key === "transform.scale" ? ["transform.scaleX", "transform.scaleY"] : [key];
	for (const p of paths) {
		if (!getElementParam({ element, key: p })) {
			const valid = getElementParams({ element }).map((x) => x.key);
			throw new Error(`No parameter ${p} on this ${element.type}. Valid: ${valid.join(", ")}`);
		}
	}
	const animations = (element as { animations?: Record<string, { keys?: Array<{ id: string }> } | undefined> }).animations;
	if (args.remove) {
		const keyframes = paths.flatMap((propertyPath) =>
			(animations?.[propertyPath]?.keys ?? []).map((k) => ({ trackId: track.id, elementId: element.id, propertyPath, keyframeId: k.id })),
		);
		if (!keyframes.length) return "That parameter has no keyframes.";
		editor().timeline.removeKeyframes({ keyframes });
		return `Removed ${keyframes.length} keyframe(s).`;
	}
	const points = (Array.isArray(args.points) ? args.points : []) as Array<{ time?: unknown; value?: unknown }>;
	if (!points.length) throw new Error("Give points: [{time, value}, …].");
	const start = element.startTime / TICKS_PER_SECOND;
	const length = element.duration / TICKS_PER_SECOND;
	const interpolation = (["linear", "hold", "bezier"].includes(String(args.interpolation)) ? args.interpolation : "bezier") as AnimationInterpolation;
	const keyframes = paths.flatMap((propertyPath) =>
		points.map((pt) => ({
			trackId: track.id,
			elementId: element.id,
			propertyPath,
			time: mediaTimeFromSeconds({ seconds: Math.min(length, Math.max(0, Number(pt.time) - start)) }),
			value: Number(pt.value),
			interpolation,
		})),
	);
	editor().timeline.upsertKeyframes({ keyframes });
	return `Set ${points.length} keyframe(s) on ${paths.join(" + ")} of ${element.id.slice(0, 8)}.`;
}

// ───────────────────────── camera moves by name ─────────────────────────

/** A named camera move on a clip as keyframes (one ⌘Z): what a push-in or a pan on real footage is in an editor. */
export const CAMERA_MOVES = ["push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "ken_burns", "shake", "punch_in"] as const;

export function cameraMove(args: Args): string {
	const { track, element } = findElement(args.id);
	if (element.type !== "video" && element.type !== "image" && element.type !== "graphic") throw new Error("A camera move goes on a video, a picture or a graphic.");
	const move = String(args.move ?? "");
	if (!(CAMERA_MOVES as readonly string[]).includes(move)) throw new Error(`move: ${CAMERA_MOVES.join(", ")}.`);
	const start = element.startTime / TICKS_PER_SECOND;
	const length = element.duration / TICKS_PER_SECOND;
	const from = Math.max(0, Math.min(length, args.from === undefined ? 0 : Number(args.from) - start));
	const to = Math.max(from + 0.1, Math.min(length, args.to === undefined ? length : Number(args.to) - start));
	const amount = Math.min(0.6, Math.max(0.02, Number(args.amount) || (move === "shake" ? 0.02 : move === "punch_in" ? 0.12 : 0.1)));
	const canvas = editor().project.getActive().settings.canvasSize;
	const span = (move.startsWith("pan") ? canvas.width : canvas.height) * amount * 0.5;
	const raw: Array<{ path: string; t: number; v: number }> = [];
	const keys = { push: (...list: Array<{ path: string; t: number; v: number }>) => raw.push(...list) };
	const scale = (t: number, v: number) => raw.push({ path: "transform.scaleX", t, v }, { path: "transform.scaleY", t, v });
	// The move starts from the clip as it is framed now: its own scale and place (a clip reframed to vertical at ×4
	// fell back to ×1.0–1.08 — a letterboxed strip — because the keys were written as if every clip filled the frame).
	const own = ((element as { params?: Record<string, unknown> }).params ?? {}) as Record<string, unknown>;
	const base = { sx: Number(own["transform.scaleX"] ?? 1) || 1, sy: Number(own["transform.scaleY"] ?? own["transform.scaleX"] ?? 1) || 1, x: Number(own["transform.positionX"] ?? 0) || 0, y: Number(own["transform.positionY"] ?? 0) || 0 };
	switch (move) {
		case "push_in":
			scale(from, 1);
			scale(to, 1 + amount);
			break;
		case "pull_out":
			scale(from, 1 + amount);
			scale(to, 1);
			break;
		case "punch_in":
			// A cut-in: the frame jumps closer and holds (hides a jump cut on a talking head).
			scale(from, 1 + amount);
			break;
		case "pan_left":
		case "pan_right": {
			const dir = move === "pan_left" ? 1 : -1;
			scale(from, 1 + amount);
			keys.push({ path: "transform.positionX", t: from, v: -dir * span }, { path: "transform.positionX", t: to, v: dir * span });
			break;
		}
		case "tilt_up":
		case "tilt_down": {
			const dir = move === "tilt_up" ? 1 : -1;
			scale(from, 1 + amount);
			keys.push({ path: "transform.positionY", t: from, v: -dir * span }, { path: "transform.positionY", t: to, v: dir * span });
			break;
		}
		case "ken_burns":
			scale(from, 1);
			scale(to, 1 + amount);
			keys.push({ path: "transform.positionX", t: from, v: 0 }, { path: "transform.positionX", t: to, v: canvas.width * amount * 0.2 });
			break;
		case "shake": {
			scale(from, 1 + amount * 2);
			// Deterministic: the same clip shakes the same way in the preview and the export.
			const steps = Math.max(4, Math.round((to - from) * 12));
			for (let i = 0; i <= steps; i++) {
				const t = from + ((to - from) * i) / steps;
				const k = Math.sin(i * 12.9898) * 43758.5453;
				keys.push({ path: "transform.positionX", t, v: ((k - Math.floor(k)) - 0.5) * canvas.width * amount }, { path: "transform.positionY", t, v: ((k * 1.7 - Math.floor(k * 1.7)) - 0.5) * canvas.height * amount * 0.6 });
			}
			break;
		}
	}
	const interpolation = (move === "shake" ? "linear" : move === "punch_in" ? "hold" : "bezier") as AnimationInterpolation;
	const placed = raw.map((k) => ({ ...k, v: k.path === "transform.scaleX" ? k.v * base.sx : k.path === "transform.scaleY" ? k.v * base.sy : k.path === "transform.positionX" ? k.v + base.x : k.v + base.y }));
	editor().timeline.upsertKeyframes({ keyframes: placed.map((k) => ({ trackId: track.id, elementId: element.id, propertyPath: k.path, time: mediaTimeFromSeconds({ seconds: k.t }), value: k.v, interpolation })) });
	const framed = Math.abs(base.sx - 1) > 0.01 || Math.abs(base.x) > 1 || Math.abs(base.y) > 1 ? ` from the clip's own framing (scale ${Math.round(base.sx * 100) / 100})` : "";
	return `${move.replace("_", " ")} on ${element.id.slice(0, 8)} ${(start + from).toFixed(1)}–${(start + to).toFixed(1)} s${framed} (${placed.length} keyframes; edit keyframes {remove:true, key} takes them off).`;
}

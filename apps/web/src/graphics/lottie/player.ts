/**
 * Deterministic Lottie frames for the compositor: one lottie-web canvas
 * instance per (animation, texts), driven with goToAndStop(frame) so the
 * preview and the export draw exactly the same pixels for the same time.
 */
import lottie from "lottie-web/build/player/lottie_canvas";
import type { AnimationConfigWithData, AnimationItem } from "lottie-web";

export type LottieTiming = "fit" | "once" | "loop";

interface LottieData {
	w: number;
	h: number;
	ip: number;
	op: number;
	fr: number;
	layers?: Array<Record<string, unknown>>;
	assets?: Array<{ layers?: Array<Record<string, unknown>> }>;
}

interface Entry {
	anim: AnimationItem;
	canvas: HTMLCanvasElement;
	data: LottieData;
	/** performance.now() of its last draw. */
	usedAt: number;
	/** The task (frame) of its last draw. */
	task: number;
}

const MAX_PLAYERS = 16;
/** A player drawn this recently, or in the frame being drawn now, is on screen and is never dropped. */
const IN_USE_MS = 2000;
/** Numbers the tasks that draw: a frame is drawn in one, however long it takes. */
let task = 0;
let taskOpen = false;

function currentTask(): number {
	if (!taskOpen) {
		taskOpen = true;
		task += 1;
		setTimeout(() => {
			taskOpen = false;
		}, 0);
	}
	return task;
}

const players = new Map<string, Entry>();
const parsed = new Map<string, LottieData | null>();

export function parseLottie(json: string): LottieData | null {
	if (parsed.has(json)) return parsed.get(json) ?? null;
	let data: LottieData | null = null;
	try {
		const value = JSON.parse(json) as LottieData;
		if (value && typeof value.w === "number" && typeof value.op === "number") data = value;
	} catch {}
	if (parsed.size > 64) parsed.delete(parsed.keys().next().value as string);
	parsed.set(json, data);
	return data;
}

/** Text layers (type 5) in document order, including those inside precomps. */
function textLayers(data: LottieData): Array<Record<string, unknown>> {
	const out: Array<Record<string, unknown>> = [];
	const walk = (layers?: Array<Record<string, unknown>>) => {
		for (const layer of layers ?? []) if (layer.ty === 5) out.push(layer);
	};
	walk(data.layers);
	for (const asset of data.assets ?? []) walk(asset.layers);
	return out;
}

/**
 * Whether the Text fields can change what the animation shows: one or two text layers drawn with a font. Text drawn
 * from glyphs embedded in the file (`chars`) has only the letters of its own words — a new word came out blank.
 */
export function lottieTextsEditable(json: string): boolean {
	const data = parseLottie(json) as (LottieData & { chars?: unknown[] }) | null;
	if (!data) return false;
	const count = textLayers(data).length;
	return count >= 1 && count <= 2 && !(Array.isArray(data.chars) && data.chars.length > 0);
}

/** Original texts of the animation's text layers (for the Text fields). */
export function lottieTexts(json: string): string[] {
	const data = parseLottie(json);
	if (!data) return [];
	return textLayers(data).map((layer) => {
		const keys = (layer.t as { d?: { k?: Array<{ s?: { t?: string } }> } })?.d?.k;
		return String(keys?.[0]?.s?.t ?? "").replace(/\r/g, "\n");
	});
}

function withTexts(data: LottieData, texts: string[]): LottieData {
	if (!texts.some(Boolean)) return data;
	const copy = structuredClone(data);
	textLayers(copy).forEach((layer, index) => {
		const text = texts[index];
		if (!text) return;
		const keys = (layer.t as { d?: { k?: Array<{ s?: { t?: string } }> } })?.d?.k ?? [];
		// Lottie uses \r for line breaks.
		for (const key of keys) if (key.s) key.s.t = text.replace(/\n/g, "\r");
	});
	return copy;
}

function getPlayer({ json, texts, size }: { json: string; texts: string[]; size: number }): Entry | null {
	if (typeof document === "undefined" || !lottie?.loadAnimation) return null;
	const key = `${json.length}:${hash(json)}:${size}:${texts.join("\u0001")}`;
	const now = performance.now();
	const drawing = currentTask();
	const cached = players.get(key);
	if (cached) {
		cached.usedAt = now;
		cached.task = drawing;
		players.delete(key);
		players.set(key, cached);
		return cached;
	}
	const base = parseLottie(json);
	if (!base) return null;
	const data = withTexts(base, texts);
	const scale = size / Math.max(base.w, base.h);
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(base.w * scale));
	canvas.height = Math.max(1, Math.round(base.h * scale));
	const context = canvas.getContext("2d");
	if (!context) return null;
	// No container: with a context and no wrapper, lottie-web sizes from the canvas itself.
	const config = {
		renderer: "canvas",
		loop: false,
		autoplay: false,
		animationData: data,
		rendererSettings: { context, clearCanvas: true, preserveAspectRatio: "xMidYMid meet" },
	} as unknown as AnimationConfigWithData<"canvas">;
	const anim = lottie.loadAnimation(config);
	const entry = { anim, canvas, data: base, usedAt: now, task: drawing };
	players.set(key, entry);
	dropIdlePlayers({ players, now, task: drawing, drop: (old) => old.anim.destroy() });
	return entry;
}

/**
 * Drops least recently drawn players over MAX_PLAYERS (the map is in that order), never one still on screen: drawn
 * in the last IN_USE_MS or in the frame being drawn now (a slow frame stays one frame). With more than MAX_PLAYERS
 * animations in one frame the cache dropped players the same frame still needed and rebuilt them on every frame —
 * building one is slow (a repeater rebuilds its layer) — so ~20 animated stickers froze the app.
 */
export function dropIdlePlayers<T extends { usedAt: number; task: number }>({
	players,
	now,
	task,
	drop,
}: {
	players: Map<string, T>;
	now: number;
	task: number;
	drop: (entry: T) => void;
}): void {
	for (const [key, entry] of players) {
		if (players.size <= MAX_PLAYERS) break;
		if (now - entry.usedAt < IN_USE_MS || entry.task === task) continue;
		drop(entry);
		players.delete(key);
	}
}

function hash(text: string): number {
	let value = 0;
	const step = Math.max(1, Math.floor(text.length / 4096));
	for (let index = 0; index < text.length; index += step) {
		value = (value * 31 + text.charCodeAt(index)) | 0;
	}
	return value;
}

/** Frame (relative to the in-point) shown at `time` seconds of a clip of `clipDuration`. */
export function lottieFrameAt({
	data,
	time,
	clipDuration,
	timing,
	speed,
}: {
	data: Pick<LottieData, "ip" | "op" | "fr">;
	time: number;
	clipDuration: number;
	timing: LottieTiming;
	speed: number;
}): number {
	const frames = Math.max(1, data.op - data.ip);
	const last = frames - 1;
	const raw = Math.max(0, time) * data.fr * Math.max(0.05, speed);
	if (timing === "fit") return clipDuration > 0 ? Math.min(last, (time / clipDuration) * frames) : 0;
	if (timing === "once") return Math.min(last, raw);
	return raw % frames;
}

/** Draws one frame, contained and centred in width × height. */
export function drawLottieFrame({
	ctx,
	width,
	height,
	json,
	texts,
	time,
	clipDuration,
	timing,
	speed,
	tint,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	width: number;
	height: number;
	json: string;
	texts: string[];
	time: number;
	clipDuration: number;
	timing: LottieTiming;
	speed: number;
	tint?: string | null;
}): boolean {
	ctx.clearRect(0, 0, width, height);
	const player = getPlayer({ json, texts, size: Math.max(width, height) });
	if (!player) return false;
	const frame = lottieFrameAt({ data: player.data, time, clipDuration, timing, speed });
	player.anim.goToAndStop(frame, true);
	const { canvas } = player;
	const scale = Math.min(width / canvas.width, height / canvas.height);
	const w = canvas.width * scale;
	const h = canvas.height * scale;
	ctx.drawImage(canvas, (width - w) / 2, (height - h) / 2, w, h);
	if (tint) {
		ctx.save();
		ctx.globalCompositeOperation = "source-atop";
		ctx.fillStyle = tint;
		ctx.fillRect(0, 0, width, height);
		ctx.restore();
	}
	return true;
}

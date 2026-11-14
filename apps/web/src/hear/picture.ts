// The picture of the sound Claude looks at: waveform over a spectrogram of a timeline range, with a time ruler, the
// words, pauses, breaths, beats, the timeline's cuts and the suggested cut points marked. The server computes the
// columns (studio/server/hear.ts → hearPicture) and a worker paints them (paint.worker.ts, OffscreenCanvas): the
// window's main thread only fetches and posts messages.
import type { Span } from "./dsp";
import type { PaintRequest, PaintResponse, SoundPart } from "./paint.worker";

export interface PicturePart {
	fileId: string;
	/** Source seconds and the timeline seconds it plays at. */
	sourceFrom: number;
	sourceLength: number;
	from: number;
	to: number;
}

export interface PictureMarks {
	words?: Array<{ start: number; end: number; text: string; n?: number; stress?: boolean }>;
	pauses?: Span[];
	breaths?: Span[];
	beats?: number[];
	downbeats?: number[];
	/** Cuts on the timeline (clip edges). */
	cuts?: number[];
	/** Suggested cut points. */
	points?: number[];
	/** Bad spots (clicks, holes, cut words), red. */
	bad?: number[];
}

interface Columns {
	cols: number;
	rows: number;
	wave: string;
	spec: string;
}

/** A paint request without its id (each kind keeps its own fields). */
type Request = PaintRequest extends infer R ? (R extends PaintRequest ? Omit<R, "id"> : never) : never;

let worker: Worker | null = null;
let next = 1;
const waiting = new Map<number, { resolve: (src: string) => void; reject: (e: Error) => void }>();

function paint(request: Request): Promise<string> {
	if (!worker) {
		worker = new Worker(new URL("./paint.worker.ts", import.meta.url), { type: "module" });
		worker.onmessage = (event: MessageEvent<PaintResponse>) => {
			const r = event.data;
			const w = waiting.get(r.id);
			if (!w) return;
			waiting.delete(r.id);
			if ("src" in r) w.resolve(r.src);
			else w.reject(new Error(r.error));
		};
		worker.onerror = (event) => {
			for (const w of waiting.values()) w.reject(new Error(event.message || "The picture couldn't be painted."));
			waiting.clear();
			worker = null;
		};
	}
	const id = next++;
	return new Promise((resolve, reject) => {
		waiting.set(id, { resolve, reject });
		worker?.postMessage({ ...request, id } as PaintRequest);
	});
}

async function columns(part: PicturePart, cols: number, rows: number, signal?: AbortSignal): Promise<Columns | null> {
	const res = await fetch("/api/hear/picture", {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-Studio": "1" },
		body: JSON.stringify({ fileId: part.fileId, from: part.sourceFrom, length: part.sourceLength, cols, rows }),
		signal,
	}).catch(() => null);
	if (!res?.ok) return null;
	return (await res.json()) as Columns;
}

/**
 * Paints [from, to] (timeline seconds) as one small JPEG data URL. `width` 300–1200 px; the height follows.
 * Colours: waveform light grey, pauses dark blue bands, breaths orange, beats purple ticks (bars taller),
 * timeline cuts white dashed, suggested cuts green, defects red.
 */
export async function paintSound(from: number, to: number, parts: PicturePart[], marks: PictureMarks, { width = 900, compact = false, signal }: { width?: number; compact?: boolean; signal?: AbortSignal } = {}): Promise<string> {
	const W = Math.max(240, Math.min(1200, Math.round(width)));
	const span = Math.max(0.05, to - from);
	const x = (t: number) => ((t - from) / span) * W;
	const rows = compact ? 32 : 64;
	const painted: SoundPart[] = [];
	for (const part of parts) {
		const xa = Math.max(0, Math.round(x(part.from)));
		const xb = Math.min(W, Math.round(x(part.to)));
		const cols = Math.max(1, xb - xa);
		const c = await columns(part, cols, rows, signal);
		if (c) painted.push({ xa, cols, wave: c.wave, spec: c.spec, specCols: c.cols, specRows: c.rows });
	}
	return paint({ kind: "sound", from, to, width: W, compact, parts: painted, marks });
}

/** Several small pictures in one sheet (the bad cuts of check_cuts), each with a caption. */
export function sheetOf(images: Array<{ src: string; label: string }>, columns = 2): Promise<string> {
	return paint({ kind: "sheet", images, columns });
}

/** A cut's review: six frames around it (or empty cells) over its sound strip. */
export function reviewOf(label: string, times: number[], frames: Array<string | null>, strip: string, width = 720): Promise<string> {
	return paint({ kind: "review", label, times, frames, strip, width });
}

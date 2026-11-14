/// <reference lib="webworker" />
// Claude's pictures of sound, painted off the main thread (OffscreenCanvas): the waveform over the spectrogram with
// the marks, the sheet of bad cuts, a cut's review (frames over its sound strip). The window only posts the data the
// server computed and gets a JPEG data URL back, so the editor never waits on a canvas.

export interface SoundPart {
	/** Pixel columns this part covers. */
	xa: number;
	cols: number;
	/** Server columns (base64): waveform min/max bytes, spectrogram rows × cols bytes. */
	wave: string;
	spec: string;
	specCols: number;
	specRows: number;
}

export interface SoundMarks {
	words?: Array<{ start: number; end: number; text: string; n?: number; stress?: boolean }>;
	pauses?: Array<{ start: number; end: number }>;
	breaths?: Array<{ start: number; end: number }>;
	beats?: number[];
	downbeats?: number[];
	cuts?: number[];
	points?: number[];
	bad?: number[];
}

export type PaintRequest =
	| { id: number; kind: "sound"; from: number; to: number; width: number; compact: boolean; parts: SoundPart[]; marks: SoundMarks }
	| { id: number; kind: "sheet"; images: Array<{ src: string; label: string }>; columns: number }
	| { id: number; kind: "review"; label: string; times: number[]; frames: Array<string | null>; strip: string; width: number };

export type PaintResponse = { id: number; src: string } | { id: number; error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function heat(v: number): [number, number, number] {
	const t = v / 255;
	const r = Math.min(255, Math.round(255 * Math.min(1, t * 1.6)));
	const g = Math.round(255 * Math.max(0, Math.min(1, (t - 0.45) * 1.9)));
	const b = Math.round(255 * Math.max(0, Math.min(1, t < 0.4 ? t * 1.6 : 0.64 - (t - 0.4) * 1.2 + Math.max(0, t - 0.85) * 4)));
	return [r, g, b];
}

const clock = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}` : `${s.toFixed(s < 10 ? 2 : 1)}`);

async function jpeg(canvas: OffscreenCanvas, quality = 0.82): Promise<string> {
	const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
	return new FileReaderSync().readAsDataURL(blob);
}

async function bitmapOf(src: string): Promise<ImageBitmap | null> {
	try {
		return await createImageBitmap(await (await fetch(src)).blob());
	} catch {
		return null;
	}
}

function paintSound(r: Extract<PaintRequest, { kind: "sound" }>): OffscreenCanvas {
	const { from, to, compact, parts, marks } = r;
	const W = Math.max(240, Math.min(1200, Math.round(r.width)));
	const ruler = compact ? 12 : 16;
	const waveH = compact ? 46 : 78;
	const specH = compact ? 50 : 92;
	const textH = compact ? 14 : 34;
	const H = ruler + waveH + specH + textH + 4;
	const span = Math.max(0.05, to - from);
	const x = (t: number) => ((t - from) / span) * W;
	const canvas = new OffscreenCanvas(W, H);
	const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
	ctx.fillStyle = "#121216";
	ctx.fillRect(0, 0, W, H);
	const y0 = ruler;
	const s0 = ruler + waveH;
	const t0 = s0 + specH;
	ctx.fillStyle = "rgba(60,90,170,0.28)";
	for (const p of marks.pauses ?? []) ctx.fillRect(x(p.start), y0, Math.max(1, x(p.end) - x(p.start)), waveH + specH);
	for (const part of parts) {
		const wave = b64(part.wave);
		const spec = b64(part.spec);
		const img = new ImageData(part.specCols, part.specRows);
		for (let row = 0; row < part.specRows; row++) {
			for (let k = 0; k < part.specCols; k++) {
				const [R, G, B] = heat(spec[row * part.specCols + k]);
				const i = (row * part.specCols + k) * 4;
				img.data[i] = R;
				img.data[i + 1] = G;
				img.data[i + 2] = B;
				img.data[i + 3] = 255;
			}
		}
		const tmp = new OffscreenCanvas(part.specCols, part.specRows);
		(tmp.getContext("2d") as OffscreenCanvasRenderingContext2D).putImageData(img, 0, 0);
		ctx.imageSmoothingEnabled = true;
		ctx.drawImage(tmp, part.xa, s0, part.cols, specH);
		ctx.fillStyle = "#d9dbe3";
		const mid = y0 + waveH / 2;
		for (let k = 0; k < part.specCols; k++) {
			const mn = (wave[2 * k] / 127.5 - 1) * (waveH / 2);
			const mx = (wave[2 * k + 1] / 127.5 - 1) * (waveH / 2);
			ctx.fillRect(part.xa + (k * part.cols) / part.specCols, mid - mx, Math.max(1, part.cols / part.specCols), Math.max(1, mx - mn));
		}
	}
	ctx.fillStyle = "rgba(255,150,40,0.85)";
	for (const b of marks.breaths ?? []) ctx.fillRect(x(b.start), y0 + waveH - 5, Math.max(2, x(b.end) - x(b.start)), 5);
	ctx.fillStyle = "#c06bff";
	const bars = new Set((marks.downbeats ?? []).map((t) => Math.round(t * 1000)));
	for (const t of marks.beats ?? []) {
		const tall = bars.has(Math.round(t * 1000));
		ctx.fillRect(x(t), t0 - (tall ? 14 : 6), tall ? 2 : 1, tall ? 14 : 6);
	}
	ctx.strokeStyle = "#ffffff";
	ctx.setLineDash([4, 3]);
	ctx.lineWidth = 1;
	for (const t of marks.cuts ?? []) {
		ctx.beginPath();
		ctx.moveTo(Math.round(x(t)) + 0.5, ruler);
		ctx.lineTo(Math.round(x(t)) + 0.5, t0);
		ctx.stroke();
	}
	ctx.setLineDash([]);
	const tri = (t: number, color: string) => {
		const px = x(t);
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.moveTo(px - 4, ruler);
		ctx.lineTo(px + 4, ruler);
		ctx.lineTo(px, ruler + 7);
		ctx.closePath();
		ctx.fill();
		ctx.fillRect(px - 0.5, ruler, 1, waveH);
	};
	for (const t of marks.points ?? []) tri(t, "#3ddc84");
	for (const t of marks.bad ?? []) tri(t, "#ff4d4f");
	ctx.fillStyle = "#1d1d24";
	ctx.fillRect(0, 0, W, ruler);
	ctx.fillStyle = "#a9abb5";
	ctx.font = `${compact ? 9 : 10}px -apple-system, sans-serif`;
	ctx.textBaseline = "middle";
	const steps = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
	const step = steps.find((s) => (span / s) * 60 <= W) ?? 60;
	for (let t = Math.ceil(from / step) * step; t <= to + 1e-9; t += step) {
		const px = x(t);
		ctx.fillRect(px, ruler - 4, 1, 4);
		ctx.fillText(clock(Math.round(t * 1000) / 1000), px + 2, ruler / 2);
	}
	ctx.font = `${compact ? 9 : 11}px -apple-system, sans-serif`;
	let lastEnd = [-Infinity, -Infinity];
	for (const w of marks.words ?? []) {
		const px = Math.max(0, x(w.start));
		const label = `${w.n ? `${w.n}·` : ""}${w.text}`;
		const tw = ctx.measureText(label).width;
		const row = !compact && px < lastEnd[0] + 2 ? 1 : 0;
		if (px < lastEnd[row] + 2) continue;
		ctx.fillStyle = w.stress ? "#ffd666" : "#e8e8ea";
		ctx.fillText(label, px, t0 + 8 + row * 15);
		ctx.fillStyle = "rgba(255,255,255,0.35)";
		ctx.fillRect(px, t0 + 1, Math.max(1, x(w.end) - x(w.start)), 2);
		lastEnd[row] = px + tw;
		if (compact) lastEnd = [lastEnd[0], lastEnd[0]];
	}
	return canvas;
}

async function paintSheet(r: Extract<PaintRequest, { kind: "sheet" }>): Promise<OffscreenCanvas> {
	const imgs = await Promise.all(r.images.map((i) => bitmapOf(i.src)));
	const w = Math.max(...imgs.map((i) => i?.width ?? 0), 1);
	const h = Math.max(...imgs.map((i) => i?.height ?? 0), 1);
	const cols = Math.min(r.columns, r.images.length);
	const rows = Math.ceil(r.images.length / cols);
	const canvas = new OffscreenCanvas(cols * (w + 6) + 6, rows * (h + 22) + 6);
	const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
	ctx.fillStyle = "#0c0c0f";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.font = "12px -apple-system, sans-serif";
	ctx.textBaseline = "middle";
	r.images.forEach((m, i) => {
		const cx = 6 + (i % cols) * (w + 6);
		const cy = 6 + Math.floor(i / cols) * (h + 22);
		ctx.fillStyle = "#ffb3b3";
		ctx.fillText(m.label.slice(0, Math.floor(w / 6.5)), cx, cy + 8);
		const img = imgs[i];
		if (img) ctx.drawImage(img, cx, cy + 16);
		img?.close();
	});
	return canvas;
}

async function paintReview(r: Extract<PaintRequest, { kind: "review" }>): Promise<OffscreenCanvas> {
	const frames = await Promise.all(r.frames.map((src) => (src ? bitmapOf(src) : Promise.resolve(null))));
	const wave = await bitmapOf(r.strip);
	const W = r.width;
	const cellW = Math.floor((W - 7 * 4) / 6);
	const first = frames.find(Boolean);
	const cellH = first ? Math.round((cellW * first.height) / first.width) : 0;
	const canvas = new OffscreenCanvas(W, 18 + (cellH ? cellH + 18 : 0) + (wave?.height ?? 0) + 4);
	const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
	ctx.fillStyle = "#0c0c0f";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.font = "12px -apple-system, sans-serif";
	ctx.textBaseline = "middle";
	ctx.fillStyle = "#ffb3b3";
	ctx.fillText(r.label.slice(0, 110), 4, 9);
	frames.forEach((img, i) => {
		const x = 4 + i * (cellW + 4);
		if (img) ctx.drawImage(img, x, 18, cellW, cellH);
		img?.close();
		ctx.fillStyle = i === 2 || i === 3 ? "#ff4d4f" : "#a9abb5";
		ctx.fillText(`${r.times[i].toFixed(2)}${i === 2 ? " ◀cut" : i === 3 ? " cut▶" : ""}`, x, 18 + cellH + 9);
	});
	if (wave) ctx.drawImage(wave, 0, 18 + (cellH ? cellH + 18 : 0));
	wave?.close();
	return canvas;
}

scope.onmessage = async (event: MessageEvent<PaintRequest>) => {
	const r = event.data;
	try {
		const canvas = r.kind === "sound" ? paintSound(r) : r.kind === "sheet" ? await paintSheet(r) : await paintReview(r);
		scope.postMessage({ id: r.id, src: await jpeg(canvas, r.kind === "review" ? 0.8 : 0.82) } satisfies PaintResponse);
	} catch (error) {
		scope.postMessage({ id: r.id, error: String((error as Error)?.message ?? error) } satisfies PaintResponse);
	}
};

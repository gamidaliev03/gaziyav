// Assets in AI layers (found by the agent for this layer only): Lottie graphics, pictures and fonts, loaded from the
// app's asset store. Same code in the editor's Player and in the export renderer; every load holds the frame
// (delayRender) and a failed load draws nothing instead of breaking the layer.
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { continueRender, delayRender, Img, useCurrentFrame, useVideoConfig } from "remotion";

export interface LayerAsset {
	type: "lottie" | "image" | "font";
	url: string;
	title?: string;
	w?: number;
	h?: number;
	duration?: number;
	fps?: number;
}

const report = (what: string, error: unknown) => console.error(`[montage-error] ${what}: ${(error as Error)?.message ?? String(error)}`);

const jsonCache = new Map<string, Promise<unknown>>();
function loadJson(url: string): Promise<unknown> {
	let p = jsonCache.get(url);
	if (!p) {
		p = fetch(url).then((r) => {
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			return r.json();
		});
		jsonCache.set(url, p);
		p.catch(() => jsonCache.delete(url));
	}
	return p;
}

type LottieModule = typeof import("lottie-web").default;
let lottieModule: Promise<LottieModule> | null = null;
const loadLottie = () => (lottieModule ??= import("lottie-web/build/player/lottie_svg").then((m) => ((m as any).default ?? m) as LottieModule));

/**
 * Every colour of a Lottie recoloured to `hex`. Each keeps its lightness within the file's own range (shading and
 * highlights survive); a one-colour file (black arrows, a white icon) takes the colour as it is.
 */
export function tintLottie(json: unknown, hex: string): unknown {
	const full = /^#[0-9a-f]{3,4}$/i.test(hex) ? `#${[...hex.slice(1, 4)].map((c) => c + c).join("")}` : hex;
	const n = Number.parseInt(full.slice(1, 7), 16);
	const tc = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
	// Every colour as [array, index of its red]: solid [r,g,b,a] (static `k` or keyframes `s`/`e`), gradient stops
	// [offset,r,g,b] × p, and solid layers' "#rrggbb".
	const spots: [number[], number][] = [];
	const hexes: { sc: string }[] = [];
	const colour = (c: { a?: number; k?: unknown } | undefined, stops = 0) => {
		const add = (a: unknown) => {
			if (!Array.isArray(a) || typeof a[0] !== "number") return;
			if (stops) for (let s = 0; s < stops && s * 4 + 3 < a.length; s++) spots.push([a, s * 4 + 1]);
			else if (a.length >= 3) spots.push([a, 0]);
		};
		if (!c) return;
		if (c.a !== 1 || !Array.isArray(c.k)) return add(c.k);
		for (const key of c.k as { s?: unknown; e?: unknown }[]) {
			add(key.s);
			add(key.e);
		}
	};
	const copy = structuredClone(json);
	const walk = (o: unknown): void => {
		if (Array.isArray(o)) {
			for (const v of o) walk(v);
			return;
		}
		if (!o || typeof o !== "object") return;
		const s = o as { ty?: unknown; c?: { a?: number; k?: unknown }; g?: { p?: number; k?: { a?: number; k?: unknown } }; sc?: string };
		if (s.ty === "fl" || s.ty === "st") colour(s.c);
		if ((s.ty === "gf" || s.ty === "gs") && s.g) colour(s.g.k, s.g.p ?? 0);
		if (typeof s.sc === "string" && /^#[0-9a-f]{6}$/i.test(s.sc)) hexes.push(s as { sc: string });
		for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
	};
	walk(copy);
	const fromHex = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
	const lum = (a: number[], i: number) => 0.3 * a[i] + 0.59 * a[i + 1] + 0.11 * a[i + 2];
	const all = [...spots.map(([a, i]) => lum(a, i)), ...hexes.map((h) => lum(fromHex(h.sc), 0))];
	const lo = Math.min(1, ...all);
	const span = Math.max(1e-6, Math.max(0, ...all) - lo);
	const flat = span < 0.12;
	const tone = (l: number) => {
		if (flat) return tc;
		const t = (l - lo) / span;
		return t < 0.6 ? tc.map((v) => v * (0.45 + 0.55 * (t / 0.6))) : tc.map((v) => v + (1 - v) * (t - 0.6) * 1.5);
	};
	for (const [a, i] of spots) {
		const [r, g, b] = tone(lum(a, i));
		a[i] = r;
		a[i + 1] = g;
		a[i + 2] = b;
	}
	for (const h of hexes) h.sc = `#${tone(lum(fromHex(h.sc), 0)).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
	return copy;
}

/** A Lottie graphic from the asset store, frame-exact (no autoplay). `tint` recolours it; `fit: "slice"` fills the box. */
export const Lottie: React.FC<{ asset?: LayerAsset | null; style?: React.CSSProperties; loop?: boolean; speed?: number; tint?: string; fit?: "meet" | "slice" }> = ({
	asset,
	style,
	loop = true,
	speed = 1,
	tint,
	fit = "meet",
}) => {
	const url = asset?.type === "lottie" ? asset.url : "";
	const [data, setData] = useState<{ lottie: LottieModule; json: unknown } | null>(null);
	const [handle] = useState(() => (url ? delayRender(`Loading Lottie ${asset?.title ?? url}`, { timeoutInMilliseconds: 20000 }) : null));
	// biome-ignore lint/correctness/useExhaustiveDependencies: loads once per file; handle is fixed state and the title only names the error
	useEffect(() => {
		if (!url) return;
		let alive = true;
		Promise.all([loadLottie(), loadJson(url)])
			.then(([lottie, json]) => alive && setData({ lottie, json }))
			.catch((error) => {
				report(`Lottie ${asset?.title ?? ""}`, error);
				if (handle !== null) continueRender(handle);
			});
		return () => {
			alive = false;
		};
	}, [url]);
	if (!url) return null;
	return data ? <LottieFrames data={data} style={style} loop={loop} speed={speed} handle={handle} tint={tint} fit={fit} /> : <div style={style} />;
};

const LottieFrames: React.FC<{
	data: { lottie: LottieModule; json: unknown };
	style?: React.CSSProperties;
	loop: boolean;
	speed: number;
	handle: number | null;
	tint?: string;
	fit: "meet" | "slice";
}> = ({ data, style, loop, speed, handle, tint, fit }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const box = useRef<HTMLDivElement>(null);
	const anim = useRef<ReturnType<LottieModule["loadAnimation"]> | null>(null);
	const frameRef = useRef(frame);
	frameRef.current = frame;
	const at = (f: number) => {
		const a = anim.current;
		if (!a) return 0;
		const rate = Number((data.json as { fr?: number }).fr) || 30;
		const total = Math.max(1, a.totalFrames);
		const lf = (f / fps) * rate * Math.max(0.05, speed);
		return loop ? lf % total : Math.min(lf, total - 1);
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: the animation is built once its data has loaded; handle is fixed state
	useLayoutEffect(() => {
		if (!box.current) return;
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			if (handle !== null) continueRender(handle);
		};
		try {
			anim.current = data.lottie.loadAnimation({
				container: box.current,
				renderer: "svg",
				loop: false,
				autoplay: false,
				// lottie-web writes into the data it is given: the shared cache gets a copy.
				animationData: tint ? tintLottie(data.json, tint) : structuredClone(data.json),
				rendererSettings: { preserveAspectRatio: `xMidYMid ${fit}` },
			});
			const onLoaded = () => {
				anim.current?.goToAndStop(at(frameRef.current), true);
				finish();
			};
			anim.current.addEventListener("DOMLoaded", onLoaded);
			if ((anim.current as unknown as { isLoaded?: boolean }).isLoaded) onLoaded();
		} catch (error) {
			report("Lottie", error);
			finish();
		}
		return () => {
			anim.current?.destroy();
			anim.current = null;
			finish();
		};
	}, [data, tint, fit]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: seeks on every frame; at() reads the loaded animation
	useLayoutEffect(() => {
		anim.current?.goToAndStop(at(frame), true);
	}, [frame]);
	return <div ref={box} style={{ width: 300, height: 300, ...style }} />;
};

/** A picture from the asset store (cover by default). */
export const Picture: React.FC<{ asset?: LayerAsset | null; style?: React.CSSProperties }> = ({ asset, style }) => {
	if (!asset || asset.type !== "image" || !asset.url) return null;
	return <Img src={asset.url} style={{ width: "100%", height: "100%", objectFit: "cover", ...style }} onError={(e) => report(`picture ${asset.title ?? ""}`, (e as unknown as { message?: string })?.message ?? "failed to load")} />;
};

const fontLoads = new Map<string, Promise<void>>();

/** CSS font-family of a font asset (loads it once; holds the frame until it is ready). */
export function useFont(asset?: LayerAsset | null, fallback = "system-ui, sans-serif"): string {
	const url = asset?.type === "font" ? asset.url : "";
	const family = url ? `ai-${url.replace(/^.*\//, "").replace(/\W/g, "").slice(0, 16)}` : "";
	const [handle] = useState(() => (family && !fontLoads.has(family) ? delayRender(`Loading font ${asset?.title ?? ""}`, { timeoutInMilliseconds: 15000 }) : null));
	// biome-ignore lint/correctness/useExhaustiveDependencies: loads once per font; handle is fixed state and the title only names the error
	useEffect(() => {
		if (!family) return;
		let p = fontLoads.get(family);
		if (!p) {
			p = new FontFace(family, `url(${url})`).load().then((face) => {
				document.fonts.add(face);
			});
			fontLoads.set(family, p);
		}
		p.catch((error) => report(`font ${asset?.title ?? ""}`, error)).finally(() => {
			if (handle !== null) continueRender(handle);
		});
	}, [family]);
	return family ? `"${family}", ${fallback}` : fallback;
}

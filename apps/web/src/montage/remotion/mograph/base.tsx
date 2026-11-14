// What every ready-made motion graphic shares (src/montage/mograph.ts): the frame's shape (9:16, 16:9, 1:1), one design
// unit, the clip's in → hold → out timing (the hold stretches with the clip), colours and fonts from the inspector.
// Motion is transforms and opacity only, so the editor's player draws every frame live without dropping any.
import type React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { type LayerAsset, Picture } from "../assets";
import { E, mix, prog } from "../ease";
import { font } from "../fonts";

export type MP = { dur: number; accent?: string; assets?: Record<string, LayerAsset> } & Record<string, unknown>;

export const str = (v: unknown, d = "") => (typeof v === "string" ? v : v == null ? d : String(v));
export const num = (v: unknown, d: number) => {
	const n = typeof v === "number" ? v : Number(v);
	return v !== "" && v != null && Number.isFinite(n) ? n : d;
};
/** A colour as #rrggbb (or #rrggbbaa): short forms are spelled out, so the kit can append an alpha («${c}66»). */
export const col = (v: unknown, d: string) => {
	if (typeof v !== "string" || !/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return d;
	return v.length <= 5 ? `#${[...v.slice(1)].map((c) => c + c).join("")}` : v;
};
export const list = (v: unknown, d: string) =>
	str(v, d)
		.split(",")
		.map((x) => x.trim())
		.filter(Boolean);
export { E, mix, prog };

export type Shape = "tall" | "wide" | "square";

export function useMg(p: MP) {
	const f = useCurrentFrame();
	const { width: W, height: H, fps } = useVideoConfig();
	const dur = Math.max(2, p.dur);
	const ar = W / H;
	const shape: Shape = ar > 1.25 ? "wide" : ar < 0.8 ? "tall" : "square";
	/** 1 = one design pixel of a 1080 px short side. */
	const u = Math.min(W, H) / 1080;
	const fr = (sec: number) => sec * fps;
	/** 0→1 from `start` s over `len` s. */
	const at = (start: number, len: number, ease = E.out) => prog(f, fr(start), fr(len), ease);
	/** Exit: 1→0 over the last `len` s (never more than a quarter of the clip). */
	const outLen = Math.min(fr(0.45), dur * 0.25);
	const out = 1 - prog(f, dur - outLen, outLen, E.in);
	/** 0→1 over the whole clip. */
	const life = Math.min(1, f / dur);
	return { f, W, H, fps, dur, L: dur / fps, shape, u, fr, at, out, life, sec: f / fps };
}

export const fontOf = (p: MP, d = "Unbounded") => font(str(p.font, d));

/** Largest size ≤ `max` at which `text` fits `width` px (per-character estimate for the kit's display fonts). */
export function fitSize(text: string, width: number, max: number, perChar = 0.62): number {
	const longest = Math.max(1, ...text.split("\n").map((l) => l.length));
	// Capitals run about a fifth wider than mixed case.
	const caps = /\p{L}/u.test(text) && text === text.toUpperCase() ? 1.22 : 1;
	return Math.max(8, Math.min(max, width / (longest * perChar * caps)));
}

/** How wide each font's heavy letters run next to the estimate above (Unbounded is very wide, Playfair narrow). */
const WIDTH: Record<string, number> = { Unbounded: 1.34, Montserrat: 1.14, Rubik: 1.02, Onest: 0.96, Manrope: 0.96, GolosText: 0.96, PlayfairDisplay: 0.9 };

/** fitSize for the layer's chosen font. */
export const fitP = (p: MP, text: string, width: number, max: number, perChar = 0.62) => fitSize(text, width, max, perChar * (WIDTH[str(p.font, "Unbounded")] ?? 1));

export const Center: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; column?: boolean; gap?: number }> = ({ children, style, column = true, gap = 0 }) => (
	<AbsoluteFill style={{ display: "flex", flexDirection: column ? "column" : "row", alignItems: "center", justifyContent: "center", gap, ...style }}>{children}</AbsoluteFill>
);

/** A full-frame colour (the Background toggle of graphics that can sit over the video or alone). */
export const Fill: React.FC<{ color: string; opacity?: number }> = ({ color, opacity = 1 }) => <AbsoluteFill style={{ background: color, opacity }} />;

/** A line of text revealed from under a mask (rises into place). */
export const MaskLine: React.FC<{ t: number; children: React.ReactNode; style?: React.CSSProperties; from?: number }> = ({ t, children, style, from = 110 }) => (
	<div style={{ overflow: "hidden", padding: "0.06em 0.04em", ...style }}>
		<div style={{ translate: `0 ${mix(from, 0, t)}%`, opacity: Math.min(1, t * 3) }}>{children}</div>
	</div>
);

/** A monogram disc standing in for a logo the user hasn't picked yet. */
export const Monogram: React.FC<{ letters: string; size: number; color: string; ink: string; family: string }> = ({ letters, size, color, ink, family }) => (
	<div style={{ width: size, height: size, borderRadius: "50%", background: color, display: "grid", placeItems: "center", color: ink, fontFamily: family, fontWeight: 800, fontSize: size * (letters.length > 1 ? 0.36 : 0.5), letterSpacing: "-0.02em" }}>
		{letters.slice(0, 3).toUpperCase()}
	</div>
);

/** A five-point star path in a 24-unit box. */
export const STAR = "M12 1.8l3.1 6.6 7.1.8-5.3 4.9 1.5 7.1L12 17.6l-6.4 3.6 1.5-7.1L1.8 9.2l7.1-.8z";

export const Stars: React.FC<{ value: number; size: number; color: string; t: number; gap?: number }> = ({ value, size, color, t, gap = 0.18 }) => (
	<div style={{ display: "flex", gap: size * gap }}>
		{[0, 1, 2, 3, 4].map((i) => {
			const shown = Math.min(1, Math.max(0, t * 6 - i));
			const fill = Math.min(1, Math.max(0, value - i));
			return (
				<svg aria-hidden="true" key={i} width={size} height={size} viewBox="0 0 24 24" style={{ scale: String(mix(0.3, 1, E.back(shown))), opacity: shown }}>
					<defs>
						<linearGradient id={`star-${i}-${Math.round(fill * 100)}`}>
							<stop offset={fill} stopColor={color} />
							<stop offset={fill} stopColor={`${color}40`} />
						</linearGradient>
					</defs>
					<path d={STAR} fill={`url(#star-${i}-${Math.round(fill * 100)})`} />
				</svg>
			);
		})}
	</div>
);

/** "1234567.8" → "1,234,568" (whole numbers; one decimal below 10). */
export function formatCount(n: number, decimals = 0): string {
	return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** The layer's logo picture from Media in a round frame, or a monogram disc until one is picked. */
export const Logo: React.FC<{ p: MP; size: number; ring?: string }> = ({ p, size, ring }) => {
	const logo = p.assets?.logo;
	if (logo?.url) {
		return (
			<div style={{ width: size, height: size, borderRadius: "50%", overflow: "hidden", background: "#fff", boxShadow: ring ? `0 0 0 ${size * 0.04}px ${ring}` : undefined }}>
				<Picture asset={logo} style={{ objectFit: "contain" }} />
			</div>
		);
	}
	return <Monogram letters={str(p.monogram).trim() || str(p.name, "B").trim().slice(0, 1) || "B"} size={size} color={col(p.accent, "#FFD23F")} ink={col(p.bg, "#0B0D12")} family={fontOf(p)} />;
};

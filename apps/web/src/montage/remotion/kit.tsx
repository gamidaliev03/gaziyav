// Motion kit of AI layers. Every component draws with the composition's style (src/montage/styles.ts): one type
// scale, one palette, one motion feel, 9:16 safe zones. Each plays inside its own <Sequence>: frame 0 = layer start,
// `dur` = layer length in frames. Positions are fractions of the frame (x, y = centre of the block unless noted).
import type React from "react";
import { AbsoluteFill, Img, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { styleOf, type LayerStyle } from "../styles";
import { E, mix, parseAccents, prog } from "./ease";
import { emojiFont, font, serifItalic } from "./fonts";

export type Word = { text: string; startMs: number; endMs: number };

/** What every kit component gets besides its own props. */
export interface KitContext {
	dur: number;
	accent: string;
	/** Timeline second of the component's frame 0 (captions need absolute time). */
	t0: number;
	words: Word[];
	media: Record<string, string>;
}

type P = KitContext & Record<string, unknown>;

const str = (v: unknown, d = "") => (typeof v === "string" ? v : v == null ? d : String(v));
const num = (v: unknown, d: number) =>
	typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d;
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

// ───────────────────────── design tokens in use ─────────────────────────

/** Style of this layer with the user's accent override. */
function useStyle(p: P): LayerStyle {
	const s = styleOf(p.style);
	const accent = typeof p.accent === "string" && /^#[0-9a-f]{3,8}$/i.test(p.accent) ? p.accent : s.accent;
	return accent === s.accent ? s : { ...s, accent };
}

/** 1 = 1 design px of a 1080-wide vertical frame. */
const useUnit = () => {
	const { width, height } = useVideoConfig();
	return Math.min(width, height) / 1080;
};

/** Frames at 30 fps → frames at the composition's fps. */
const useT = () => {
	const { fps } = useVideoConfig();
	return (frames30: number) => (frames30 * fps) / 30;
};

/** Type scale (design px). */
const SCALE = { display: 104, title: 72, subtitle: 50, body: 38, small: 28, caption: 70 };

function typeStyle(s: LayerStyle, size: number, role: "display" | "body" = "display"): React.CSSProperties {
	const display = role === "display";
	return {
		fontFamily: font(display ? s.display : s.body),
		fontWeight: display ? s.displayWeight : s.bodyWeight,
		fontSize: size,
		letterSpacing: display ? `${s.tracking}em` : "0em",
		textTransform: display && s.upper ? "uppercase" : "none",
		color: s.text,
		lineHeight: display ? 1.04 : 1.25,
		WebkitTextStroke: s.stroke > 0 ? `${size * s.stroke}px rgba(0,0,0,0.92)` : undefined,
		paintOrder: "stroke fill",
		textShadow:
			s.glow > 0
				? `0 0 ${size * 0.25}px ${s.accent}88, 0 0 ${size * 0.6}px ${s.accent}44`
				: `0 ${Math.max(1, size * 0.04)}px ${size * 0.22}px rgba(0,0,0,0.45)`,
	};
}

/** Spring 0→1 with the style's feel, starting at `delay` frames (30 fps units). */
function useEnter(s: LayerStyle, delay = 0) {
	const f = useCurrentFrame();
	const { fps } = useVideoConfig();
	return spring({ frame: f - (delay * fps) / 30, fps, config: s.motion.spring, durationInFrames: Math.round((s.motion.enter * fps) / 30) + 6 });
}

/** 1→0 at the end of the layer (exit ≈ 55 % of the entrance). */
function useExit(s: LayerStyle, dur: number) {
	const f = useCurrentFrame();
	const { fps } = useVideoConfig();
	const len = Math.max(4, Math.round((s.motion.enter * 0.55 * fps) / 30));
	return 1 - prog(f, dur - len, len, E.in);
}

const Block: React.FC<{ x?: number; y: number; children: React.ReactNode; maxW?: number; align?: "center" | "left" }> = ({
	x = 0.5,
	y,
	children,
	maxW = 0.84,
	align = "center",
}) => {
	const { width, height } = useVideoConfig();
	return (
		<div
			style={{
				position: "absolute",
				left: x * width,
				top: y * height,
				translate: align === "center" ? "-50% -50%" : "0 -50%",
				width: align === "center" ? width * maxW : undefined,
				maxWidth: width * maxW,
				display: "flex",
				flexDirection: "column",
				alignItems: align === "center" ? "center" : "flex-start",
				textAlign: align,
				pointerEvents: "none",
			}}
		>
			{children}
		</div>
	);
};

/** Largest size ≤ `max` at which the longest line fits `widthPx`. */
function fitSize(lines: string[], widthPx: number, max: number, s: LayerStyle): number {
	const longest = Math.max(1, ...lines.map((l) => l.length));
	const perChar = (s.upper ? 0.66 : 0.56) * (s.display === "Unbounded" ? 1.22 : s.display === "PlayfairDisplay" ? 0.92 : 1);
	return Math.min(max, widthPx / (longest * perChar));
}

// ───────────────────────── Hook title ─────────────────────────

/** Hook: words rise out of masks one by one; *accent* words get the style's accent treatment. */
export const HookTitle: React.FC<P> = (p) => {
	const f = useCurrentFrame();
	const { width, fps } = useVideoConfig();
	const u = useUnit();
	const t = useT();
	const s = useStyle(p);
	const lines = parseAccents(str(p.text, "Main *idea*"));
	const fs = fitSize(lines.map((l) => l.map((w) => w.w).join(" ")), width * 0.82, num(p.size, SCALE.display) * u, s);
	const kicker = str(p.kicker);
	const out = useExit(s, p.dur);
	const dim = num(p.dim, 0.28);
	const drift = mix(1, 1.025, Math.min(1, f / Math.max(1, p.dur)));
	let i = 0;
	return (
		<AbsoluteFill>
			{dim > 0 && (
				<AbsoluteFill
					style={{
						background: `radial-gradient(70% 38% at 50% ${num(p.y, 0.24) * 100}%, rgba(0,0,0,${dim + 0.12}) 0%, rgba(0,0,0,${dim * 0.4}) 60%, transparent 100%)`,
						opacity: prog(f, 0, t(8)) * out,
					}}
				/>
			)}
			<Block y={num(p.y, 0.24)}>
				<div style={{ scale: String(drift), opacity: out, translate: `0 ${(1 - out) * -30 * u}px` }}>
					{kicker && (
						<div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14 * u, marginBottom: 16 * u, opacity: prog(f, t(2), t(10)) }}>
							<div style={{ width: 44 * u, height: 3 * u, borderRadius: 2 * u, background: s.accent, scale: `${prog(f, 0, t(10))} 1`, transformOrigin: "right" }} />
							<div style={{ ...typeStyle(s, SCALE.small * u, "body"), color: s.muted, letterSpacing: "0.08em", WebkitTextStroke: undefined }}>{kicker}</div>
							<div style={{ width: 44 * u, height: 3 * u, borderRadius: 2 * u, background: s.accent, scale: `${prog(f, 0, t(10))} 1`, transformOrigin: "left" }} />
						</div>
					)}
					{lines.map((line, li) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: lines of a fixed text, by position
						<div key={li} style={{ display: "flex", gap: `0 ${fs * 0.26}px`, justifyContent: "center", flexWrap: "wrap" }}>
							{line.map((w, wi) => {
								const delay = 3 + 2.2 * i++;
								const pr = spring({ frame: f - t(delay), fps, config: s.motion.spring });
								const accent = w.accent;
								const marker = accent && (s.id === "bold" || s.id === "hormozi" || s.id === "playful");
								const base = typeStyle(s, fs);
								const wordStyle: React.CSSProperties = accent
									? marker
										? { ...base, color: s.ink, WebkitTextStroke: undefined, textShadow: undefined }
										: s.id === "luxury"
											? { ...base, fontFamily: serifItalic(), color: s.accent }
											: { ...base, color: s.accent }
									: base;
								return (
									// biome-ignore lint/suspicious/noArrayIndexKey: words of a fixed line, by position
									<span key={wi} style={{ display: "inline-block", overflow: "hidden", padding: `${fs * 0.04}px ${fs * 0.08}px ${fs * 0.1}px`, margin: `0 -${fs * 0.08}px`, position: "relative" }}>
										{marker && (
											<span
												style={{
													position: "absolute",
													inset: `${fs * 0.1}px ${fs * 0.02}px ${fs * 0.08}px`,
													background: s.accent,
													borderRadius: s.radius * u * 0.6,
													scale: `${prog(f, t(delay + 2), t(7), E.out)} 1`,
													transformOrigin: "left",
													rotate: s.id === "playful" ? "-2deg" : "-1deg",
												}}
											/>
										)}
										<span style={{ ...wordStyle, display: "inline-block", position: "relative", translate: `0 ${(1 - pr) * 105}%`, rotate: `${(1 - pr) * 5}deg` }}>{w.w}</span>
									</span>
								);
							})}
						</div>
					))}
				</div>
			</Block>
		</AbsoluteFill>
	);
};

// ───────────────────────── Captions ─────────────────────────

const HANGING = new Set("в во на к ко с со у о об от до по за из без для при про и а но да не ни же ли бы то a an the of to in on at and or".split(" "));
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");

/** Pages of ≤ maxWords words: break on sentence ends and pauses; prepositions stick to the next word. */
export function captionPages(words: Word[], maxWords: number): number[][] {
	const pages: number[][] = [];
	let cur: number[] = [];
	words.forEach((w, i) => {
		const prev = words[cur[cur.length - 1]];
		const prevText = prev ? norm(prev.text) : "";
		const breakHere =
			cur.length > 0 && !HANGING.has(prevText) && (cur.length >= maxWords || w.startMs - prev.endMs > 450 || /[.!?…]$/.test(prev.text.trim()));
		if (breakHere) {
			pages.push(cur);
			cur = [];
		}
		cur.push(i);
	});
	if (cur.length) pages.push(cur);
	return pages;
}

const WORDS_PER_PAGE: Record<string, number> = { box: 4, pop: 3, hormozi: 2, minimal: 5, glow: 3, serif: 4, bubble: 3 };

/** Word-synced captions in the style's caption look. */
export const Captions: React.FC<P> = (p) => {
	const f = useCurrentFrame();
	const { fps, width, height } = useVideoConfig();
	const u = useUnit();
	const s = useStyle(p);
	const words = p.words;
	if (!words.length) return null;
	const look = s.captions;
	const maxWords = Math.max(1, Math.min(6, Math.round(num(p.maxWords, WORDS_PER_PAGE[look] ?? 3))));
	const ms = (p.t0 + f / fps) * 1000;
	const pages = captionPages(words, maxWords);
	const pi = pages.findIndex((pg, k) => {
		const start = words[pg[0]].startMs - 80;
		const end = pages[k + 1] ? words[pages[k + 1][0]].startMs - 80 : words[pg[pg.length - 1]].endMs + 400;
		return ms >= start && ms < end;
	});
	if (pi < 0) return null;
	const page = pages[pi];
	const pageStart = words[page[0]].startMs - 80;
	const pageFrame = Math.max(0, Math.round(((ms - pageStart) / 1000) * fps));
	const pageIn = spring({ frame: pageFrame, fps, config: s.motion.spring });
	const size = (look === "hormozi" ? 92 : look === "minimal" ? 52 : look === "serif" ? 60 : look === "box" ? 56 : look === "bubble" ? 62 : SCALE.caption) * u * num(p.scale, 1);
	const base = typeStyle(s, size);
	const upper = look === "hormozi" || look === "pop" || look === "glow";
	const plate = look === "box" || look === "bubble";
	return (
		<AbsoluteFill style={{ pointerEvents: "none" }}>
			<div
				style={{
					position: "absolute",
					left: width * 0.08,
					right: width * 0.08,
					top: num(p.y, 0.64) * height,
					translate: `0 calc(-50% + ${(1 - pageIn) * (look === "minimal" || look === "serif" ? 8 : 14) * u}px)`,
					display: "flex",
					justifyContent: "center",
				}}
			>
				<div
					style={{
						display: "flex",
						flexWrap: "wrap",
						justifyContent: "center",
						alignItems: "baseline",
						// One even word space for every look: the outline paints outside the glyphs, so it is added to the gap;
						// the active word grows ≤ 5 % so it never touches its neighbours.
						columnGap: size * ((look === "minimal" || look === "serif" ? 0.27 : 0.3) + (plate ? 0 : s.stroke) + (look === "glow" ? 0.16 : 0)),
						rowGap: size * 0.06,
						opacity: look === "minimal" || look === "serif" ? Math.min(1, pageIn * 1.4) : 1,
						scale: look === "hormozi" || look === "pop" ? String(mix(0.86, 1, pageIn)) : undefined,
						background: look === "box" ? s.plate : look === "bubble" ? s.plate : undefined,
						border: look === "box" ? `${1.5 * u}px solid ${s.plateBorder}` : undefined,
						backdropFilter: look === "box" && s.blur ? `blur(${s.blur * u}px)` : undefined,
						padding: plate ? `${size * 0.22}px ${size * 0.42}px ${size * 0.26}px` : 0,
						borderRadius: plate ? (look === "bubble" ? size * 0.7 : s.radius * u) : 0,
						boxShadow: look === "bubble" ? s.shadow : look === "box" ? "0 12px 40px rgba(0,0,0,0.3)" : undefined,
						maxWidth: width * 0.84,
					}}
				>
					{page.map((wi) => {
						const w = words[wi];
						const on = ms >= w.startMs && ms < w.endMs + 60;
						const said = ms >= w.startMs;
						const sp = spring({ frame: Math.max(0, Math.round(((ms - w.startMs) / 1000) * fps)), fps, config: { damping: 12, stiffness: 240, mass: 0.55 } });
						// The spoken word lifts and grows a touch (≤ 3 %, no overshoot) so word spacing never changes.
						const settle = Math.min(1, sp);
						const pop = mix(0.96, 1.03, settle);
						const lift = on ? (1 - settle) * size * 0.08 : 0;
						let color = s.text;
						let scale = 1;
						let extra: React.CSSProperties = {};
						switch (look) {
							case "hormozi":
								color = on ? s.accent : s.text;
								scale = on ? pop : 1;
								break;
							case "pop":
								color = on ? s.accent : said ? s.text : "rgba(255,255,255,0.6)";
								scale = on ? pop : 1;
								break;
							case "box":
								color = on ? s.accent2 : said ? s.text : s.muted;
								break;
							case "minimal":
								color = s.text;
								extra = { opacity: said ? 1 : 0.38 };
								break;
							case "glow":
								color = on ? s.accent : s.text;
								extra = on ? { textShadow: `0 0 ${size * 0.3}px ${s.accent}, 0 0 ${size * 0.7}px ${s.accent}99` } : { textShadow: `0 0 ${size * 0.18}px ${s.accent}44` };
								scale = on ? pop : 1;
								break;
							case "serif":
								color = on ? s.accent : said ? s.text : s.muted;
								break;
							case "bubble":
								color = on ? s.accent : s.ink;
								scale = on ? pop : 1;
								break;
						}
						return (
							<span
								key={wi}
								style={{
									...base,
									...(plate ? { WebkitTextStroke: undefined, textShadow: undefined } : {}),
									textTransform: upper ? "uppercase" : "none",
									display: "inline-block",
									color,
									scale: String(scale),
									translate: lift ? `0 ${lift}px` : undefined,
									transformOrigin: "50% 60%",
									...extra,
								}}
							>
								{w.text.trim().replace(/[,.;:]+$/, "")}
							</span>
						);
					})}
				</div>
			</div>
		</AbsoluteFill>
	);
};

// ───────────────────────── lower third ─────────────────────────

/** Name + role, top-left by default (clear of the captions and the platform UI). */
export const LowerThird: React.FC<P> = (p) => {
	const f = useCurrentFrame();
	const { width, height, fps } = useVideoConfig();
	const u = useUnit();
	const t = useT();
	const s = useStyle(p);
	const out = useExit(s, p.dur);
	const role = str(p.role);
	const bar = prog(f, 0, t(10));
	const wipe = prog(f, t(3), t(12));
	const nameIn = spring({ frame: f - t(6), fps, config: s.motion.spring });
	const roleIn = prog(f, t(11), t(10));
	const quiet = s.id === "minimal" || s.id === "luxury";
	const nameSize = (quiet ? 46 : 50) * u;
	const roleSize = 30 * u;
	return (
		<div
			style={{
				position: "absolute",
				left: num(p.x, 0.06) * width,
				top: num(p.y, 0.17) * height,
				display: "flex",
				alignItems: "stretch",
				gap: quiet ? 18 * u : 0,
				opacity: out,
				translate: `${-36 * (1 - out) * u}px 0`,
			}}
		>
			<div style={{ width: (quiet ? 2 : 8) * u, background: s.accent, scale: `1 ${bar}`, transformOrigin: "top", borderRadius: 4 * u, boxShadow: s.glow ? `0 0 ${14 * u}px ${s.accent}` : undefined }} />
			<div
				style={{
					background: quiet ? "transparent" : s.plate,
					border: !quiet && s.plateBorder !== "rgba(255,255,255,0)" ? `${1.5 * u}px solid ${s.plateBorder}` : undefined,
					borderLeft: "none",
					backdropFilter: !quiet && s.blur ? `blur(${s.blur * u}px)` : undefined,
					padding: quiet ? `${2 * u}px 0` : `${16 * u}px ${28 * u}px ${18 * u}px ${24 * u}px`,
					borderRadius: quiet ? 0 : `0 ${s.radius * u}px ${s.radius * u}px 0`,
					clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`,
					boxShadow: quiet ? undefined : "0 14px 40px rgba(0,0,0,0.3)",
				}}
			>
				<div style={{ overflow: "hidden" }}>
					<div
						style={{
							...typeStyle(s, nameSize),
							WebkitTextStroke: undefined,
							textShadow: quiet ? "0 1px 3px rgba(0,0,0,0.7), 0 2px 22px rgba(0,0,0,0.55)" : "none",
							color: s.id === "playful" ? s.ink : s.text,
							translate: `0 ${(1 - nameIn) * 105}%`,
							whiteSpace: "nowrap",
						}}
					>
						{str(p.name, "Name")}
					</div>
				</div>
				{role && (
					<div
						style={{
							...typeStyle(s, roleSize, "body"),
							color: s.id === "playful" ? s.ink : quiet ? s.accent2 : s.muted,
							marginTop: 6 * u,
							opacity: roleIn,
							translate: `0 ${(1 - roleIn) * 10 * u}px`,
							whiteSpace: "nowrap",
							letterSpacing: quiet ? "0.03em" : undefined,
							textShadow: quiet ? "0 1px 3px rgba(0,0,0,0.8), 0 2px 18px rgba(0,0,0,0.6)" : "none",
						}}
					>
						{role}
					</div>
				)}
			</div>
		</div>
	);
};

// ───────────────────────── CTA ─────────────────────────

/** Call to action: spring entrance, gentle pulse with a ring, a light sweep, nudging arrow. */
export const CTA: React.FC<P> = (p) => {
	const f = useCurrentFrame();
	const u = useUnit();
	const t = useT();
	const s = useStyle(p);
	const inS = useEnter(s);
	const out = useExit(s, p.dur);
	const period = t(36);
	const start = t(16);
	const cyc = f >= start ? (f - start) % period : -1;
	const pulse = cyc >= 0 && cyc < t(12) ? 1 + Math.sin((cyc / t(12)) * Math.PI) * 0.045 : 1;
	const ring = cyc >= 0 ? prog(cyc, 0, t(20), E.out) : 0;
	const shine = prog(f, t(14), t(16), E.inOut);
	const outline = s.id === "minimal" || s.id === "luxury" || s.id === "neon";
	const icon = str(p.icon);
	const fg = outline ? s.text : s.ink;
	const size = (s.id === "luxury" ? 44 : 50) * u;
	return (
		<Block y={num(p.y, 0.56)} x={num(p.x, 0.5)} maxW={0.8}>
			<div style={{ position: "relative", opacity: out * Math.min(1, inS * 1.6), translate: `0 ${(1 - inS) * 26 * u}px`, scale: String(mix(0.82, 1, inS) * pulse) }}>
				{cyc >= 0 && !outline && (
					<div style={{ position: "absolute", inset: 0, borderRadius: 999, border: `${3 * u}px solid ${s.accent}`, scale: String(mix(1, 1.35, ring)), opacity: (1 - ring) * 0.55 }} />
				)}
				<div
					style={{
						position: "relative",
						overflow: "hidden",
						background: outline ? (s.id === "neon" ? s.plate : "rgba(0,0,0,0.18)") : s.accent,
						border: outline ? `${(s.id === "luxury" ? 1.5 : 2.5) * u}px solid ${s.accent}` : undefined,
						backdropFilter: outline ? `blur(${10 * u}px)` : undefined,
						borderRadius: s.id === "luxury" ? 2 * u : 999,
						padding: `${24 * u}px ${52 * u}px`,
						boxShadow: s.glow ? `0 0 ${30 * u}px ${s.accent}88` : outline ? undefined : `0 ${14 * u}px ${34 * u}px ${s.accent}55`,
						display: "flex",
						gap: 16 * u,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					{icon && s.emoji && <span style={{ fontSize: size * 1.05, fontFamily: emojiFont(), lineHeight: 1 }}>{icon}</span>}
					<span style={{ ...typeStyle(s, size), color: fg, WebkitTextStroke: undefined, textShadow: s.glow ? `0 0 ${size * 0.3}px ${s.accent}` : undefined, whiteSpace: "nowrap" }}>
						{str(p.text, "Tap the link")}
					</span>
					<svg
						width={size * 0.9}
						height={size * 0.9}
						viewBox="0 0 24 24"
						fill="none"
						stroke={outline ? s.accent : fg}
						strokeWidth={2.6}
						strokeLinecap="round"
						strokeLinejoin="round"
						style={{ translate: `${cyc >= t(2) && cyc < t(14) ? Math.sin(((cyc - t(2)) / t(12)) * Math.PI) * 6 * u : 0}px 0` }}
					>
						<path d="M5 12h13M13 6l6 6-6 6" />
					</svg>
					{!outline && (
						<div style={{ position: "absolute", top: 0, bottom: 0, width: "26%", left: `${mix(-30, 130, shine)}%`, background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.55), transparent)" }} />
					)}
				</div>
			</div>
		</Block>
	);
};

// ───────────────────────── plates & cards ─────────────────────────

/** Offer plate: accent block slides in with a light sweep; optional line under it. */
export const Plate: React.FC<P> = (p) => {
	const f = useCurrentFrame();
	const u = useUnit();
	const t = useT();
	const s = useStyle(p);
	const inS = useEnter(s);
	const out = useExit(s, p.dur);
	const shine = prog(f, t(10), t(22), E.inOut);
	const skew = s.id === "bold" || s.id === "hormozi" ? -7 : 0;
	const quiet = s.id === "minimal" || s.id === "luxury";
	const fs = num(p.size, 60) * u;
	const sub = str(p.sub);
	return (
		<Block y={num(p.y, 0.32)} x={num(p.x, 0.5)}>
			<div style={{ opacity: out * Math.min(1, inS * 1.5), translate: `${(1 - inS) * -80 * u}px 0`, transform: skew ? `skewX(${skew}deg)` : undefined, display: "flex", flexDirection: "column", alignItems: "center" }}>
				<div
					style={{
						position: "relative",
						overflow: "hidden",
						background: quiet ? "transparent" : s.accent,
						borderTop: quiet ? `${1.5 * u}px solid ${s.accent}` : undefined,
						borderBottom: quiet ? `${1.5 * u}px solid ${s.accent}` : undefined,
						padding: `${fs * 0.24}px ${fs * 0.5}px`,
						borderRadius: quiet ? 0 : s.radius * u,
						boxShadow: quiet ? undefined : s.glow ? `0 0 ${30 * u}px ${s.accent}` : "0 20px 50px rgba(0,0,0,0.35)",
					}}
				>
					<div style={{ ...typeStyle(s, fs), transform: skew ? `skewX(${-skew}deg)` : undefined, color: quiet ? s.text : s.ink, WebkitTextStroke: undefined, textShadow: quiet ? s.shadow : undefined, whiteSpace: "nowrap" }}>
						{str(p.text, "Offer")}
					</div>
					{!quiet && <div style={{ position: "absolute", top: 0, bottom: 0, width: "30%", left: `${mix(-40, 130, shine)}%`, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)" }} />}
				</div>
				{sub && (
					<div style={{ ...typeStyle(s, fs * 0.55, "body"), marginTop: fs * 0.22, transform: skew ? `skewX(${-skew}deg)` : undefined, textShadow: "0 4px 18px rgba(0,0,0,0.7)", opacity: prog(f, t(8), t(10)) }}>{sub}</div>
				)}
			</div>
		</Block>
	);
};

/** Fact card: plate in the style, accent rule, title + one line. */
export const Card: React.FC<P> = (p) => {
	const f = useCurrentFrame();
	const u = useUnit();
	const t = useT();
	const s = useStyle(p);
	const inS = useEnter(s);
	const out = useExit(s, p.dur);
	const icon = str(p.icon);
	const text = str(p.text);
	const light = s.id === "playful";
	return (
		<Block y={num(p.y, 0.3)} x={num(p.x, 0.5)} maxW={0.84}>
			<div
				style={{
					translate: `0 ${(1 - inS) * 40 * u}px`,
					scale: String(mix(0.94, 1, inS)),
					opacity: out * Math.min(1, inS * 1.6),
					display: "flex",
					gap: 24 * u,
					alignItems: "center",
					background: s.plate,
					border: `${1.5 * u}px solid ${s.plateBorder}`,
					borderRadius: s.radius * u,
					padding: `${28 * u}px ${36 * u}px`,
					boxShadow: "0 26px 60px rgba(0,0,0,0.32)",
					backdropFilter: s.blur ? `blur(${s.blur * u}px)` : undefined,
				}}
			>
				<div style={{ width: 6 * u, alignSelf: "stretch", borderRadius: 4 * u, background: s.accent, scale: `1 ${prog(f, t(2), t(10))}`, transformOrigin: "top" }} />
				{icon && s.emoji && <div style={{ fontSize: 76 * u, fontFamily: emojiFont(), lineHeight: 1 }}>{icon}</div>}
				<div>
					<div style={{ ...typeStyle(s, 50 * u), WebkitTextStroke: undefined, textShadow: undefined, color: light ? s.ink : s.text, opacity: prog(f, t(4), t(10)) }}>{str(p.title, "Fact")}</div>
					{text && <div style={{ ...typeStyle(s, 32 * u, "body"), color: light ? s.ink : s.muted, marginTop: 8 * u, opacity: prog(f, t(8), t(10)) }}>{text}</div>}
				</div>
			</div>
		</Block>
	);
};

// ───────────────────────── numbers ─────────────────────────

const fmt = (v: number, decimals: number) =>
	new Intl.NumberFormat("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v).replace(/\s/g, " ");

/** Big number counting up (expo-out), settles with a small punch; label rises under it. */
export const Counter: React.FC<P> = (p) => {
	const f = useCurrentFrame();
	const { fps } = useVideoConfig();
	const u = useUnit();
	const t = useT();
	const s = useStyle(p);
	const to = num(p.value, 100);
	const from = num(p.from, 0);
	const decimals = Math.max(0, Math.min(2, Math.round(num(p.decimals, 0))));
	const len = Math.round(fps * 1.1);
	const pr = prog(f, 0, len, E.out);
	const settle = prog(f, len, t(8), E.back);
	const out = useExit(s, p.dur);
	const label = str(p.label);
	const size = num(p.size, 170) * u;
	return (
		<Block y={num(p.y, 0.3)} x={num(p.x, 0.5)}>
			<div style={{ opacity: out * prog(f, 0, t(6)), scale: String(mix(0.86, 1, prog(f, 0, t(12), E.out)) * (f >= len ? mix(1.05, 1, settle) : 1)), display: "flex", flexDirection: "column", alignItems: "center" }}>
				<div style={{ ...typeStyle(s, size), color: s.accent, fontVariantNumeric: "tabular-nums", lineHeight: 1, whiteSpace: "nowrap", textTransform: "none" }}>
					{str(p.prefix)}
					{fmt(mix(from, to, pr), decimals)}
					{str(p.suffix)}
				</div>
				{label && (
					<div style={{ ...typeStyle(s, 40 * u, "body"), marginTop: 12 * u, opacity: prog(f, t(8), t(10)), translate: `0 ${(1 - prog(f, t(8), t(12))) * 16 * u}px`, textShadow: "0 4px 20px rgba(0,0,0,0.6)" }}>{label}</div>
				)}
			</div>
		</Block>
	);
};

/** Price card: old price struck through, new price springs in, badge stamps, light sweep. */
export const PriceCard: React.FC<P> = (p) => {
	const f = useCurrentFrame();
	const { fps } = useVideoConfig();
	const u = useUnit();
	const t = useT();
	const s = useStyle(p);
	const cur = str(p.currency, "₽");
	const oldPrice = num(p.oldPrice, 0);
	const newPrice = num(p.newPrice, 990);
	const badge = str(p.badge);
	const title = str(p.title);
	const inS = useEnter(s);
	const out = useExit(s, p.dur);
	const priceS = spring({ frame: f - t(16), fps, config: { damping: 11, stiffness: 180 } });
	const stamp = prog(f, t(22), t(6), E.inOut);
	const sweep = prog(f, t(30), t(18), E.linear);
	return (
		<Block y={num(p.y, 0.4)} x={num(p.x, 0.5)}>
			<div
				style={{
					position: "relative",
					overflow: "hidden",
					opacity: out * Math.min(1, inS * 1.5),
					scale: String(mix(0.92, 1, inS)),
					minWidth: 640 * u,
					padding: `${34 * u}px ${44 * u}px`,
					borderRadius: s.radius * u * 1.4,
					background: s.plate,
					border: `${1.5 * u}px solid ${s.plateBorder}`,
					boxShadow: "0 30px 60px rgba(0,0,0,0.35)",
					backdropFilter: s.blur ? `blur(${s.blur * u}px)` : undefined,
					textAlign: "center",
				}}
			>
				{title && <div style={{ ...typeStyle(s, 36 * u, "body"), opacity: prog(f, t(5), t(8)) }}>{title}</div>}
				{oldPrice > 0 && (
					<div style={{ position: "relative", display: "inline-block", marginTop: 8 * u, ...typeStyle(s, 56 * u, "body"), color: s.muted, opacity: prog(f, t(8), t(6)) }}>
						{fmt(oldPrice, 0)}&nbsp;{cur}
						<div style={{ position: "absolute", left: -6 * u, right: -6 * u, top: "52%", height: 7 * u, borderRadius: 4 * u, background: s.accent2, rotate: "-7deg", scale: `${prog(f, t(12), t(6))} 1`, transformOrigin: "left" }} />
					</div>
				)}
				<div style={{ ...typeStyle(s, 132 * u), WebkitTextStroke: undefined, color: s.accent, fontVariantNumeric: "tabular-nums", scale: String(mix(0.6, 1, priceS)), opacity: f >= t(16) ? 1 : 0, whiteSpace: "nowrap", textTransform: "none" }}>
					{fmt(newPrice, 0)}&nbsp;{cur}
				</div>
				{badge && (
					<div
						style={{
							position: "absolute",
							right: 22 * u,
							top: 22 * u,
							background: s.accent2,
							color: s.ink,
							...typeStyle(s, 38 * u),
							WebkitTextStroke: undefined,
							textShadow: undefined,
							padding: `${8 * u}px ${18 * u}px`,
							borderRadius: s.radius * u * 0.6,
							rotate: "-8deg",
							scale: String(mix(2, 1, stamp)),
							filter: `blur(${(1 - stamp) * 6}px)`,
							opacity: f >= t(22) ? 1 : 0,
						}}
					>
						{badge}
					</div>
				)}
				<div style={{ position: "absolute", top: 0, bottom: 0, width: "40%", left: `${mix(-120, 220, sweep)}%`, background: "linear-gradient(110deg, transparent, rgba(255,255,255,0.28), transparent)", opacity: sweep > 0 && sweep < 1 ? 1 : 0 }} />
			</div>
		</Block>
	);
};

// ───────────────────────── badges, stickers ─────────────────────────

/** Round badge («-50%», «NEW») that stamps in and breathes. */
export const Badge: React.FC<P> = (p) => {
	const f = useCurrentFrame();
	const u = useUnit() * num(p.scale, 1);
	const t = useT();
	const s = useStyle(p);
	const text = str(p.text, "-50%");
	const pr = prog(f, 0, t(12), E.back);
	const out = useExit(s, p.dur);
	const rot = -10 + Math.sin(f / t(10)) * 3;
	const quiet = s.id === "minimal" || s.id === "luxury";
	return (
		<Block y={num(p.y, 0.22)} x={num(p.x, 0.78)} maxW={0.3}>
			<div
				style={{
					width: 210 * u,
					height: 210 * u,
					borderRadius: "50%",
					background: quiet ? "transparent" : s.accent,
					border: quiet ? `${2 * u}px solid ${s.accent}` : `${6 * u}px solid ${s.id === "neon" ? s.accent2 : "#fff"}`,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					scale: String(pr),
					rotate: `${rot}deg`,
					opacity: out,
					boxShadow: s.glow ? `0 0 ${30 * u}px ${s.accent}` : quiet ? undefined : "0 18px 44px rgba(0,0,0,0.4)",
				}}
			>
				<div style={{ ...typeStyle(s, 60 * u * Math.min(1, 3.6 / Math.max(1, text.length))), WebkitTextStroke: undefined, textShadow: undefined, color: quiet ? s.text : s.ink, textAlign: "center", lineHeight: 1 }}>{text}</div>
			</div>
		</Block>
	);
};

/** Emoji sticker (Noto Color Emoji) with a deterministic burst of copies. */
export const Sticker: React.FC<P> = (p) => {
	const f = useCurrentFrame();
	const u = useUnit() * num(p.scale, 1);
	const t = useT();
	const s = useStyle(p);
	const emoji = str(p.emoji, "🔥");
	const burst = bool(p.burst, true);
	const pr = spring({ frame: f, fps: useVideoConfig().fps, config: { damping: 9, stiffness: 160 } });
	const out = useExit(s, p.dur);
	const seed = str(p.id, "s");
	return (
		<Block y={num(p.y, 0.3)} x={num(p.x, 0.78)} maxW={0.4}>
			<div style={{ position: "relative", opacity: out }}>
				{burst &&
					new Array(8).fill(0).map((_, i) => {
						const th = (2 * Math.PI * i) / 8 + (random(`${seed}${i}`) - 0.5) * 0.6;
						const v = 16 + 14 * random(`${seed}${i}v`);
						const life = Math.min(f * (30 / t(30)), 30);
						const k = (1 - 0.96 ** life) / 0.04;
						const x = Math.cos(th) * v * k * u;
						const y = Math.sin(th) * v * k * u + 0.6 * life * life * u;
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: a fixed burst of 8 particles
							<div key={i} style={{ position: "absolute", left: "50%", top: "50%", fontSize: 50 * u, fontFamily: emojiFont(), translate: `calc(-50% + ${x}px) calc(-50% + ${y}px)`, rotate: `${life * (random(`${seed}${i}r`) * 10 - 5)}deg`, opacity: 1 - prog(f, t(20), t(10), E.linear), scale: String(prog(f, 0, t(4), E.back)) }}>
								{emoji}
							</div>
						);
					})}
				<div style={{ fontSize: 180 * u, lineHeight: 1, fontFamily: emojiFont(), scale: String(pr), rotate: `${mix(-15, 0, pr) + Math.sin(f / t(7)) * 4}deg`, filter: "drop-shadow(0 16px 26px rgba(0,0,0,0.4))" }}>{emoji}</div>
			</div>
		</Block>
	);
};

// ───────────────────────── b-roll, progress, finish ─────────────────────────

/** Photo cutaway (`card` framed over the speaker or `full` frame). */
export const Cutaway: React.FC<P> = (p) => {
	const f = useCurrentFrame();
	const { width, height } = useVideoConfig();
	const u = useUnit();
	const s = useStyle(p);
	const src = p.media[str(p.mediaId)] ?? str(p.src);
	const mode = str(p.mode, "card");
	const label = str(p.label);
	const push = mix(1, 1.08, f / Math.max(1, p.dur));
	const inS = useEnter(s);
	const out = useExit(s, p.dur);
	if (!src) return null;
	const img = <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", scale: String(push) }} />;
	if (mode === "full") {
		return <AbsoluteFill style={{ opacity: out * Math.min(1, inS * 2), overflow: "hidden" }}>{img}</AbsoluteFill>;
	}
	return (
		<AbsoluteFill>
			<div
				style={{
					position: "absolute",
					left: width * 0.08,
					width: width * 0.84,
					height: height * 0.36,
					top: num(p.y, 0.36) * height - height * 0.18,
					borderRadius: s.radius * u * 1.4,
					overflow: "hidden",
					border: `${5 * u}px solid ${s.id === "luxury" ? s.accent : "#fff"}`,
					boxShadow: "0 30px 60px rgba(0,0,0,0.45)",
					scale: String(mix(0.88, 1, inS)),
					rotate: `${mix(-3, 0, inS)}deg`,
					opacity: out,
				}}
			>
				{img}
			</div>
			{label && (
				<div style={{ position: "absolute", left: "50%", top: (num(p.y, 0.36) + 0.2) * height, translate: "-50% 0", background: s.accent, borderRadius: 999, padding: `${10 * u}px ${24 * u}px`, ...typeStyle(s, 34 * u, "body"), color: s.ink, opacity: out }}>{label}</div>
			)}
		</AbsoluteFill>
	);
};

/** Thin progress bar at the top of the safe zone (fast start keeps viewers watching). */
export const ProgressBar: React.FC<P> = (p) => {
	const f = useCurrentFrame();
	const { width, height } = useVideoConfig();
	const u = useUnit();
	const t = useT();
	const s = useStyle(p);
	const x = f / Math.max(1, p.dur);
	const fill = x < 0.2 ? x * 1.75 : 0.35 + (x - 0.2) * (0.65 / 0.8);
	return (
		<div style={{ position: "absolute", left: width * 0.08, width: width * 0.84, top: num(p.y, 0.13) * height, height: 6 * u, borderRadius: 6 * u, background: "rgba(255,255,255,0.22)", overflow: "hidden", scale: `${prog(f, 0, t(10))} 1` }}>
			<div style={{ height: "100%", width: "100%", background: s.accent, scale: `${Math.min(1, fill)} 1`, transformOrigin: "left", boxShadow: s.glow ? `0 0 ${12 * u}px ${s.accent}` : undefined }} />
		</div>
	);
};

/** Film finish over the whole composition: grain + vignette + a light leak at the start. */
export const Finish: React.FC<P> = (p) => {
	const f = useCurrentFrame();
	const t = useT();
	const s = useStyle(p);
	const grain = num(p.grain, 0.05);
	const vignette = num(p.vignette, 0.28);
	const leak = prog(f, 0, t(34), E.inOut);
	const seed = Math.floor(f / Math.max(1, t(2))) % 40;
	return (
		<AbsoluteFill style={{ pointerEvents: "none" }}>
			{bool(p.leak, true) && leak > 0 && leak < 1 && (
				<AbsoluteFill style={{ mixBlendMode: "screen", opacity: Math.sin(leak * Math.PI) * 0.4, background: `radial-gradient(60% 80% at ${mix(-20, 120, leak)}% ${mix(30, 70, leak)}%, ${s.accent} 0%, transparent 70%)` }} />
			)}
			{vignette > 0 && <AbsoluteFill style={{ background: `radial-gradient(ellipse 85% 75% at 50% 50%, transparent 45%, rgba(0,0,0,${vignette}) 100%)` }} />}
			{grain > 0 && (
				<AbsoluteFill style={{ mixBlendMode: "overlay", opacity: grain }}>
					<svg width="100%" height="100%">
						<filter id={`mg${seed}`}>
							<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={seed} stitchTiles="stitch" />
							<feColorMatrix type="saturate" values="0" />
						</filter>
						<rect width="100%" height="100%" filter={`url(#mg${seed})`} />
					</svg>
				</AbsoluteFill>
			)}
		</AbsoluteFill>
	);
};

/** Kit components by layer kind. */
export const KIT: Record<string, React.FC<P>> = {
	HookTitle,
	Captions,
	Plate,
	Card,
	Counter,
	PriceCard,
	Badge,
	Sticker,
	CTA,
	LowerThird,
	Cutaway,
	ProgressBar,
	Finish,
};

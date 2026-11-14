// Bumpers (full-frame stingers between scenes), intros and logo reveals, outros and end screens.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { serifItalic } from "../fonts";
import { Center, col, E, Fill, fitP, fontOf, Logo, MaskLine, mix, type MP, str, useMg } from "./base";

// ───────────── Bumpers ─────────────

/** Three skewed colour stripes wipe across, the word rides the last one, and they wipe on out. */
export const MgStripeWipe: React.FC<MP> = (p) => {
	const m = useMg(p);
	const colors = [col(p.accent, "#FFD23F"), col(p.color2, "#FF3D71"), col(p.color3, "#2D7BFF")];
	const exit = m.L - 0.6;
	const x = (i: number) => mix(-150, 0, m.at(i * 0.08, 0.5, E.inOut)) + mix(0, 150, m.at(exit + (2 - i) * 0.06, 0.48, E.inOut));
	// A tall frame stacks the words (bigger than one long line).
	const title = m.shape === "tall" ? str(p.title, "NEXT UP").split(/\s+/).join("\n") : str(p.title, "NEXT UP");
	const size = fitP(p, title, m.W * 0.8, 230 * m.u);
	return (
		<AbsoluteFill style={{ overflow: "hidden" }}>
			{colors.map((c, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn in the same order every frame
				<div key={c + i} style={{ position: "absolute", top: "-10%", bottom: "-10%", left: "-25%", right: "-25%", background: c, transform: `translateX(${x(i)}%) skewX(-14deg)` }} />
			))}
			<Center style={{ transform: `translateX(${x(2) * 0.6}%)` }}>
				<MaskLine t={m.at(0.32, 0.5)}>
					<div style={{ fontFamily: fontOf(p), fontWeight: 900, fontSize: size, color: col(p.ink, "#0B0D12"), letterSpacing: "-0.02em", fontStyle: "italic", whiteSpace: "pre", textAlign: "center", lineHeight: 1 }}>{title}</div>
				</MaskLine>
			</Center>
		</AbsoluteFill>
	);
};

/** Rings burst from the centre, a disc fills the frame, the word pops; the disc closes back to a point. */
export const MgCircleBurst: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FF3D71");
	const b = col(p.color2, "#FFD23F");
	const diag = Math.hypot(m.W, m.H);
	const close = m.at(m.L - 0.5, 0.5, E.in);
	const disc = (delay: number) => mix(0, 1, m.at(delay, 0.55, E.inOut)) * (1 - close);
	const title = str(p.title, "WOW");
	return (
		<AbsoluteFill style={{ overflow: "hidden" }}>
			{[0, 1, 2].map((i) => {
				const t = m.at(i * 0.08, 0.9);
				return <div key={i} style={{ position: "absolute", left: "50%", top: "50%", width: diag * 0.5, height: diag * 0.5, translate: "-50% -50%", borderRadius: "50%", border: `${mix(40, 2, t) * m.u}px solid ${i % 2 ? b : a}`, scale: String(mix(0, 2.4, t)), opacity: 1 - t }} />;
			})}
			<div style={{ position: "absolute", left: "50%", top: "50%", width: diag, height: diag, translate: "-50% -50%", borderRadius: "50%", background: b, scale: String(disc(0.05)) }} />
			<div style={{ position: "absolute", left: "50%", top: "50%", width: diag, height: diag, translate: "-50% -50%", borderRadius: "50%", background: a, scale: String(disc(0.14)) }} />
			<Center>
				<div style={{ fontFamily: fontOf(p), fontWeight: 900, fontSize: fitP(p, title, m.W * 0.8, 260 * m.u), color: col(p.ink, "#FFFFFF"), scale: String(mix(0, 1, E.back(m.at(0.32, 0.45, E.linear))) * (1 - close)), rotate: `${mix(-8, 0, m.at(0.32, 0.5))}deg` }}>{title}</div>
			</Center>
		</AbsoluteFill>
	);
};

/** Two panels close from the top and the bottom, a line draws between title and subtitle; the panels open again. */
export const MgSplitBumper: React.FC<MP> = (p) => {
	const m = useMg(p);
	const panel = col(p.color2, "#111827");
	const close = m.at(0, 0.5, E.inOut);
	const open = m.at(m.L - 0.5, 0.5, E.inOut);
	const shift = mix(-102, 0, close) + mix(0, -102, open);
	const line = m.at(0.35, 0.6, E.inOut) * (1 - m.at(m.L - 0.6, 0.3, E.in));
	const title = str(p.title, "CHAPTER 2");
	const family = fontOf(p, "Montserrat");
	return (
		<AbsoluteFill style={{ overflow: "hidden" }}>
			<div style={{ position: "absolute", left: 0, right: 0, top: 0, height: "50.5%", background: panel, translate: `0 ${shift}%` }} />
			<div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "50.5%", background: panel, translate: `0 ${-shift}%` }} />
			<Center gap={28 * m.u} style={{ opacity: 1 - open }}>
				<MaskLine t={m.at(0.45, 0.5)} from={100}>
					<div style={{ fontFamily: family, fontWeight: 900, fontSize: fitP(p, title, m.W * 0.84, 150 * m.u), color: col(p.ink, "#FFFFFF"), letterSpacing: "0.04em" }}>{title}</div>
				</MaskLine>
				<div style={{ width: m.W * 0.5 * line, height: 6 * m.u, background: col(p.accent, "#00E0B8"), borderRadius: 3 * m.u }} />
				<MaskLine t={m.at(0.6, 0.5)} from={-100}>
					<div style={{ fontFamily: family, fontWeight: 600, fontSize: 52 * m.u, color: col(p.accent, "#00E0B8"), letterSpacing: "0.08em", textTransform: "uppercase" }}>{str(p.sub)}</div>
				</MaskLine>
			</Center>
		</AbsoluteFill>
	);
};

/** The word flies in from far away, holds, and the camera zooms through it. */
export const MgZoomThrough: React.FC<MP> = (p) => {
	const m = useMg(p);
	const inT = m.at(0, 0.55);
	const through = m.at(m.L - 0.45, 0.45, E.in);
	const scale = mix(6, 1, inT) * mix(1, 1.06, m.life) * mix(1, 14, through);
	const title = str(p.title, "BOOM");
	const c = col(p.accent, "#FFFFFF");
	return (
		<AbsoluteFill style={{ overflow: "hidden" }}>
			<Fill color={col(p.bg, "#111111")} opacity={Math.min(1, m.at(0, 0.18, E.linear)) * (1 - through)} />
			{Array.from({ length: 14 }, (_, i) => {
				const t = (m.sec * 1.6 + i / 14) % 1;
				// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn in the same order every frame
				return <div key={i} style={{ position: "absolute", left: "50%", top: "50%", width: Math.hypot(m.W, m.H) * 0.06, height: 4 * m.u, background: c, opacity: 0.35 * (1 - t) * (1 - through), transform: `rotate(${(i * 360) / 14}deg) translateX(${mix(60, Math.hypot(m.W, m.H) * 0.55, t)}px)`, transformOrigin: "0 50%" }} />;
			})}
			<Center>
				<div style={{ fontFamily: fontOf(p), fontWeight: 900, fontSize: fitP(p, title, m.W * 0.82, 280 * m.u), color: c, scale: String(scale), opacity: Math.min(1, inT * 2) * (1 - through) }}>{title}</div>
			</Center>
		</AbsoluteFill>
	);
};

/** A grid of blocks flips in diagonally, the word lands on top, the blocks flip away. */
export const MgBlockBumper: React.FC<MP> = (p) => {
	const m = useMg(p);
	const cols = m.shape === "wide" ? 8 : m.shape === "square" ? 6 : 5;
	const size = m.W / cols;
	const rows = Math.ceil(m.H / size);
	const a = col(p.accent, "#c98a1e");
	const b = col(p.color2, "#22D3EE");
	const title = str(p.title, "MEANWHILE");
	const span = cols + rows;
	return (
		<AbsoluteFill style={{ overflow: "hidden" }}>
			{Array.from({ length: cols * rows }, (_, k) => {
				const c = k % cols;
				const r = Math.floor(k / cols);
				const d = (c + r) / span;
				const t = m.at(d * 0.45, 0.32, E.inOut) * (1 - m.at(m.L - 0.62 + d * 0.4, 0.22, E.in));
				// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn in the same order every frame
				return <div key={k} style={{ position: "absolute", left: c * size, top: r * size, width: size + 1, height: size + 1, background: (c + r) % 2 ? a : b, scale: `1 ${t}`, opacity: t > 0 ? 1 : 0 }} />;
			})}
			<Center>
				<div style={{ fontFamily: fontOf(p, "Rubik"), fontWeight: 900, fontSize: fitP(p, title, m.W * 0.84, 170 * m.u), color: col(p.ink, "#FFFFFF"), letterSpacing: "0.02em", scale: String(mix(0.6, 1, E.back(m.at(0.5, 0.4, E.linear)))), opacity: m.at(0.5, 0.2) * (1 - m.at(m.L - 0.6, 0.15, E.in)), textShadow: `0 ${8 * m.u}px ${30 * m.u}px rgba(0,0,0,0.35)` }}>{title}</div>
			</Center>
		</AbsoluteFill>
	);
};

// ───────────── Intros & logos ─────────────

/** A ring draws itself, the logo pops inside it with a spark burst, the name tracks in, the tagline follows. */
export const MgLogoReveal: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FFD23F");
	const size = (m.shape === "wide" ? 300 : 340) * m.u;
	const ring = m.at(0, 0.9, E.inOut);
	const pop = E.back(m.at(0.35, 0.5, E.linear));
	const burst = m.at(0.55, 0.8);
	const r = size * 0.62;
	const family = fontOf(p);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop !== false && <Fill color={col(p.bg, "#0B0D12")} />}
			<Center gap={34 * m.u} style={{ scale: String(mix(1, 0.96, 1 - m.out)) }}>
				<div style={{ position: "relative", width: size, height: size }}>
					<svg aria-hidden="true" width={r * 2.2} height={r * 2.2} style={{ position: "absolute", left: size / 2 - r * 1.1, top: size / 2 - r * 1.1, rotate: `${mix(-90, 0, ring)}deg` }}>
						<circle cx={r * 1.1} cy={r * 1.1} r={r} fill="none" stroke={a} strokeWidth={6 * m.u} strokeLinecap="round" strokeDasharray={Math.PI * 2 * r} strokeDashoffset={Math.PI * 2 * r * (1 - ring)} />
					</svg>
					{Array.from({ length: 12 }, (_, i) => {
						const ang = (i / 12) * Math.PI * 2;
						const d = mix(r * 0.9, r * 1.7, burst);
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn in the same order every frame
						return <div key={i} style={{ position: "absolute", left: size / 2 + Math.cos(ang) * d - 6 * m.u, top: size / 2 + Math.sin(ang) * d - 6 * m.u, width: 12 * m.u, height: 12 * m.u, borderRadius: "50%", background: i % 2 ? a : col(p.ink, "#FFFFFF"), opacity: burst > 0 ? 1 - burst : 0, scale: String(1 - burst * 0.6) }} />;
					})}
					<div style={{ position: "absolute", inset: 0, scale: String(pop) }}>
						<Logo p={p} size={size} />
					</div>
				</div>
				<div style={{ fontFamily: family, fontWeight: 800, fontSize: fitP(p, str(p.name, "BRAND"), m.W * 0.8, 96 * m.u, 0.8), color: col(p.ink, "#FFFFFF"), letterSpacing: `${mix(0.6, 0.14, m.at(0.7, 1.2))}em`, opacity: m.at(0.7, 0.5), marginRight: "-0.14em" }}>{str(p.name, "BRAND")}</div>
				<div style={{ fontFamily: family, fontWeight: 500, fontSize: 38 * m.u, color: a, opacity: m.at(1.1, 0.5), translate: `0 ${mix(20, 0, m.at(1.1, 0.6)) * m.u}px` }}>{str(p.tagline)}</div>
			</Center>
		</AbsoluteFill>
	);
};

/** Four hairlines draw a frame around the name, the logo fades in above it, the tagline types below. */
export const MgLineReveal: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FFFFFF");
	const name = str(p.name, "STUDIO NAME");
	const fs = fitP(p, name, m.W * 0.66, 110 * m.u, 0.78);
	const w = Math.min(m.W * 0.8, name.length * fs * 0.78 + 140 * m.u);
	const h = fs * 2.2;
	const t = (i: number) => m.at(0.1 + i * 0.18, 0.4, E.inOut);
	const line = 3 * m.u;
	const tag = str(p.tagline);
	const typed = Math.round(tag.length * m.at(1.3, 0.8, E.linear));
	const family = fontOf(p, "Montserrat");
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop !== false && <Fill color={col(p.bg, "#101010")} />}
			<Center gap={40 * m.u}>
				<div style={{ opacity: m.at(0.9, 0.5), scale: String(mix(0.85, 1, m.at(0.9, 0.6))) }}>{p.assets?.logo?.url ? <Logo p={p} size={150 * m.u} /> : null}</div>
				<div style={{ position: "relative", width: w, height: h, display: "grid", placeItems: "center" }}>
					<div style={{ position: "absolute", left: 0, top: 0, height: line, width: `${t(0) * 100}%`, background: a }} />
					<div style={{ position: "absolute", right: 0, top: 0, width: line, height: `${t(1) * 100}%`, background: a }} />
					<div style={{ position: "absolute", right: 0, bottom: 0, height: line, width: `${t(2) * 100}%`, background: a }} />
					<div style={{ position: "absolute", left: 0, bottom: 0, width: line, height: `${t(3) * 100}%`, background: a }} />
					<MaskLine t={m.at(0.6, 0.6)}>
						<div style={{ fontFamily: family, fontWeight: 700, fontSize: fs, color: col(p.ink, "#FFFFFF"), letterSpacing: "0.18em", marginRight: "-0.18em", whiteSpace: "nowrap" }}>{name}</div>
					</MaskLine>
				</div>
				<div style={{ fontFamily: family, fontWeight: 500, fontSize: 34 * m.u, color: col(p.ink, "#FFFFFF"), opacity: 0.8, letterSpacing: "0.3em", minHeight: 40 * m.u, textTransform: "uppercase" }}>{tag.slice(0, typed)}</div>
			</Center>
		</AbsoluteFill>
	);
};

/** Letterbox bars, a slow-tracking serif title with a light sweep, a gold hairline and a subtitle. */
export const MgCinematicTitle: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#E8C77A");
	const bars = m.at(0, 0.8, E.inOut) * m.out;
	const title = str(p.title, "THE JOURNEY");
	const fs = fitP(p, title, m.W * 0.82, 150 * m.u, 0.9);
	const sweep = mix(-60, 160, m.at(0.6, 1.8, E.inOut));
	const family = fontOf(p, "PlayfairDisplay");
	const barH = m.shape === "wide" ? m.H * 0.12 : m.H * 0.09;
	return (
		<AbsoluteFill>
			{p.backdrop === true && <Fill color="#000000" opacity={0.55 * m.out} />}
			<div style={{ position: "absolute", left: 0, right: 0, top: 0, height: barH * bars, background: "#000" }} />
			<div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: barH * bars, background: "#000" }} />
			<Center gap={30 * m.u} style={{ opacity: m.out }}>
				<div
					style={{
						fontFamily: family,
						fontWeight: 600,
						fontSize: fs,
						letterSpacing: `${mix(0.12, 0.32, m.life)}em`,
						marginRight: `-${mix(0.12, 0.32, m.life)}em`,
						whiteSpace: "nowrap",
						opacity: m.at(0.2, 1.2, E.inOut),
						backgroundImage: `linear-gradient(100deg, ${col(p.ink, "#FFFFFF")} ${sweep - 20}%, ${a} ${sweep}%, ${col(p.ink, "#FFFFFF")} ${sweep + 20}%)`,
						WebkitBackgroundClip: "text",
						backgroundClip: "text",
						color: "transparent",
					}}
				>
					{title}
				</div>
				<div style={{ width: m.W * 0.22 * m.at(0.8, 1, E.inOut), height: 2 * m.u, background: a }} />
				<div style={{ fontFamily: serifItalic(), fontSize: 46 * m.u, color: col(p.ink, "#FFFFFF"), opacity: 0.85 * m.at(1.1, 0.9), letterSpacing: "0.04em" }}>{str(p.sub)}</div>
			</Center>
		</AbsoluteFill>
	);
};

/** Slow colour fields drifting behind a big title that rises word by word. */
export const MgGradientIntro: React.FC<MP> = (p) => {
	const m = useMg(p);
	const colors = [col(p.accent, "#FF3D71"), col(p.color2, "#c98a1e"), col(p.color3, "#22D3EE")];
	const big = Math.max(m.W, m.H) * 1.3;
	const words = str(p.title, "Hello, world").split(/\s+/).filter(Boolean);
	const title = words.join(" ");
	const fs = fitP(p, title, m.W * (m.shape === "tall" ? 1.5 : 0.84), 170 * m.u, 0.6);
	const family = fontOf(p, "Onest");
	return (
		<AbsoluteFill style={{ opacity: m.out, overflow: "hidden", background: "#0B0B14" }}>
			{colors.map((c, i) => {
				const ang = m.sec * 0.5 + (i * Math.PI * 2) / 3;
				// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn in the same order every frame
				return <div key={c + i} style={{ position: "absolute", left: m.W / 2 + Math.cos(ang) * m.W * 0.28 - big / 2, top: m.H / 2 + Math.sin(ang * 1.3) * m.H * 0.24 - big / 2, width: big, height: big, borderRadius: "50%", background: `radial-gradient(circle, ${c} 0%, ${c}00 62%)`, opacity: 0.85 * m.at(0, 0.8) }} />;
			})}
			<Center gap={24 * m.u} style={{ padding: `0 ${m.W * 0.08}px` }}>
				<div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: fs * 0.28 }}>
					{words.map((w, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn in the same order every frame
						<MaskLine key={w + i} t={m.at(0.3 + i * 0.12, 0.6)}>
							<span style={{ fontFamily: family, fontWeight: 800, fontSize: fs, color: col(p.ink, "#FFFFFF"), letterSpacing: "-0.03em" }}>{w}</span>
						</MaskLine>
					))}
				</div>
				<div style={{ fontFamily: family, fontWeight: 600, fontSize: 40 * m.u, color: col(p.ink, "#FFFFFF"), opacity: 0.8 * m.at(0.6 + words.length * 0.12, 0.6), letterSpacing: "0.22em", textTransform: "uppercase" }}>{str(p.sub)}</div>
			</Center>
		</AbsoluteFill>
	);
};

// ───────────── Outros & end screens ─────────────

const PlayCard: React.FC<{ w: number; label: string; t: number; accent: string; family: string; u: number }> = ({ w, label, t, accent, family, u }) => (
	<div style={{ width: w, opacity: t, scale: String(mix(0.86, 1, E.back(t))), display: "flex", flexDirection: "column", gap: 12 * u }}>
		<div style={{ width: w, height: (w * 9) / 16, borderRadius: 18 * u, border: `${4 * u}px solid rgba(255,255,255,0.85)`, background: "rgba(255,255,255,0.08)", display: "grid", placeItems: "center" }}>
			<div style={{ width: w * 0.16, height: w * 0.16, borderRadius: "50%", background: accent, display: "grid", placeItems: "center" }}>
				<div style={{ width: 0, height: 0, borderTop: `${w * 0.035}px solid transparent`, borderBottom: `${w * 0.035}px solid transparent`, borderLeft: `${w * 0.055}px solid #fff`, marginLeft: w * 0.012 }} />
			</div>
		</div>
		<div style={{ fontFamily: family, fontWeight: 700, fontSize: Math.max(22 * u, w * 0.075), color: "#fff" }}>{label}</div>
	</div>
);

/** YouTube-style end screen: title, two «watch next» slots, the channel picture with a subscribe button. */
export const MgEndScreen: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FF2E4D");
	const family = fontOf(p, "Montserrat");
	const wide = m.shape === "wide";
	const card = wide ? m.W * 0.3 : m.shape === "square" ? m.W * 0.4 : m.W * 0.72;
	const pic = (wide ? 260 : 220) * m.u;
	const cards = (
		<div style={{ display: "flex", flexDirection: wide || m.shape === "square" ? "row" : "column", gap: 36 * m.u }}>
			<PlayCard w={card} label={str(p.next, "Watch next")} t={m.at(0.5, 0.5, E.linear)} accent={a} family={family} u={m.u} />
			<PlayCard w={card} label={str(p.more, "Best of")} t={m.at(0.65, 0.5, E.linear)} accent={a} family={family} u={m.u} />
		</div>
	);
	const sub = (
		<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 * m.u, opacity: m.at(0.8, 0.4), scale: String(mix(0.8, 1, E.back(m.at(0.8, 0.5, E.linear)))) }}>
			<Logo p={p} size={pic} ring={a} />
			<div style={{ background: a, color: "#fff", fontFamily: family, fontWeight: 800, fontSize: 40 * m.u, padding: `${16 * m.u}px ${40 * m.u}px`, borderRadius: 999, letterSpacing: "0.04em", scale: String(1 + 0.04 * Math.sin(m.sec * 6) * m.at(1.4, 0.3)) }}>{str(p.button, "SUBSCRIBE")}</div>
		</div>
	);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop !== false && <Fill color={col(p.bg, "#0E1117")} />}
			<Center gap={50 * m.u} style={{ padding: 60 * m.u }}>
				<MaskLine t={m.at(0.15, 0.6)}>
					<div style={{ fontFamily: family, fontWeight: 800, fontSize: fitP(p, str(p.title), m.W * 0.86, 86 * m.u, 0.58), color: col(p.ink, "#FFFFFF") }}>{str(p.title, "Thanks for watching!")}</div>
				</MaskLine>
				<div style={{ display: "flex", flexDirection: wide ? "row" : "column", alignItems: "center", gap: 60 * m.u }}>
					{wide ? sub : cards}
					{wide ? cards : sub}
				</div>
			</Center>
		</AbsoluteFill>
	);
};

/** A circle opens on the brand colour, the logo settles in the middle, the name and website slide up. */
export const MgLogoOutro: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FFD23F");
	const open = m.at(0, 0.7, E.inOut);
	const r = Math.hypot(m.W, m.H) * 0.5 * open;
	const family = fontOf(p);
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			{p.backdrop !== false && <AbsoluteFill style={{ background: col(p.bg, "#0B0D12"), clipPath: `circle(${r}px at 50% 50%)` }} />}
			<Center gap={30 * m.u}>
				<div style={{ scale: String(mix(1.5, 1, m.at(0.25, 0.8))), opacity: m.at(0.25, 0.3) }}>
					<Logo p={p} size={260 * m.u} />
				</div>
				<MaskLine t={m.at(0.6, 0.6)}>
					<div style={{ fontFamily: family, fontWeight: 800, fontSize: fitP(p, str(p.name, "BRAND"), m.W * 0.8, 90 * m.u, 0.72), color: col(p.ink, "#FFFFFF"), letterSpacing: "0.08em" }}>{str(p.name, "BRAND")}</div>
				</MaskLine>
				<div style={{ fontFamily: family, fontWeight: 600, fontSize: 36 * m.u, color: col(p.bg, "#0B0D12"), background: a, padding: `${10 * m.u}px ${30 * m.u}px`, borderRadius: 999, opacity: m.at(0.85, 0.4), translate: `0 ${mix(30, 0, m.at(0.85, 0.5)) * m.u}px` }}>{str(p.url, "brand.com")}</div>
			</Center>
		</AbsoluteFill>
	);
};

/** Generic glyphs (not brand logos): a camera, a note, a play button. */
const Glyph: React.FC<{ kind: number; size: number; color: string }> = ({ kind, size, color }) => (
	<svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
		{kind === 0 && (
			<>
				<rect x="3" y="3" width="18" height="18" rx="5" />
				<circle cx="12" cy="12" r="4" />
				<circle cx="17.5" cy="6.5" r="0.8" fill={color} />
			</>
		)}
		{kind === 1 && <path d="M9 18a3 3 0 1 1-3-3h3V4c1 2.5 3 4 6 4" />}
		{kind === 2 && (
			<>
				<rect x="2.5" y="5" width="19" height="14" rx="4" />
				<path d="M10 9.2v5.6l4.8-2.8z" fill={color} />
			</>
		)}
	</svg>
);

/** «Follow us» with three handles sliding in, each behind its round icon. */
export const MgSocialHandles: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FF3D71");
	const family = fontOf(p, "Manrope");
	const handles = [str(p.handle1), str(p.handle2), str(p.handle3)].map((h, i) => [h, i] as const).filter(([h]) => h.trim());
	const row = 96 * m.u;
	return (
		<AbsoluteFill style={{ opacity: m.out }}>
			<Center gap={30 * m.u}>
				<MaskLine t={m.at(0.1, 0.5)}>
					<div style={{ fontFamily: family, fontWeight: 800, fontSize: 70 * m.u, color: col(p.ink, "#FFFFFF"), textShadow: "0 4px 24px rgba(0,0,0,0.4)" }}>{str(p.title, "Follow us")}</div>
				</MaskLine>
				<div style={{ display: "flex", flexDirection: m.shape === "wide" ? "row" : "column", gap: 26 * m.u }}>
					{handles.map(([h, i], k) => {
						const t = m.at(0.35 + k * 0.14, 0.55);
						return (
							<div key={i} style={{ display: "flex", alignItems: "center", gap: 18 * m.u, background: "rgba(10,12,18,0.72)", borderRadius: 999, padding: `${10 * m.u}px ${34 * m.u}px ${10 * m.u}px ${10 * m.u}px`, opacity: t, translate: `${mix(-80, 0, t) * m.u}px 0` }}>
								<div style={{ width: row, height: row, borderRadius: "50%", background: a, display: "grid", placeItems: "center", scale: String(E.back(Math.min(1, t * 1.2))) }}>
									<Glyph kind={i} size={row * 0.56} color="#fff" />
								</div>
								<span style={{ fontFamily: family, fontWeight: 700, fontSize: 44 * m.u, color: col(p.ink, "#FFFFFF") }}>{h}</span>
							</div>
						);
					})}
				</div>
			</Center>
		</AbsoluteFill>
	);
};

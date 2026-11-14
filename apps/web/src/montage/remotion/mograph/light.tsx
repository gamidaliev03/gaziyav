// Light and texture over the video (light leak, film burn, lens flare, grain and dust, CRT, rain), particles drawn by
// the kit (fireworks, hearts, bubbles) and full-frame stingers (glitch, shutter blinds, liquid wipe). Everything is a
// pure function of the frame and remotion `random`, so the player, a scrub and the export draw the same frame.
import type React from "react";
import { AbsoluteFill, random } from "remotion";
import { col, E, fitP, fontOf, mix, type MP, num, str, useMg } from "./base";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ids = (p: MP, what: string) => `${what}-${str(p.id, "mg").replace(/[^\w-]/g, "")}`;
const count = (p: MP, d: number, max: number) => clamp(Math.round(num(p.amount, d)), 4, max);

/** A soft glowing disc (light, flare ghosts, burn). */
const Glow: React.FC<{ x: number; y: number; r: number; color: string; opacity?: number; core?: string }> = ({ x, y, r, color, opacity = 1, core }) => (
	<div style={{ position: "absolute", left: x - r, top: y - r, width: 2 * r, height: 2 * r, borderRadius: "50%", opacity, background: `radial-gradient(circle, ${core ?? color} 0%, ${color}cc 22%, ${color}55 48%, ${color}18 64%, transparent 72%)` }} />
);

// ───────────── Light & texture ─────────────

/** Warm light leaking in from the edges: big soft blobs drifting and breathing, a pale streak sweeping across. */
export const MgLightLeak: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FF6A1A");
	const b = col(p.color2, "#FFD36B");
	const k = clamp(num(p.intensity, 0.85), 0.1, 1);
	const t = m.sec * clamp(num(p.speed, 1), 0.2, 3);
	const D = Math.hypot(m.W, m.H);
	const env = m.at(0, 0.9, E.inOut) * m.out;
	const sweep = (t * 0.18) % 1.6;
	return (
		<AbsoluteFill style={{ opacity: env * k, overflow: "hidden", mixBlendMode: "screen" }}>
			<Glow x={m.W * (-0.05 + 0.18 * Math.sin(t * 0.5))} y={m.H * (0.25 + 0.25 * Math.sin(t * 0.33 + 1))} r={D * 0.42} color={a} opacity={0.75 + 0.25 * Math.sin(t * 1.3)} />
			<Glow x={m.W * (1.02 - 0.12 * Math.sin(t * 0.41 + 2))} y={m.H * (0.78 + 0.15 * Math.sin(t * 0.37))} r={D * 0.36} color="#FF2E4D" opacity={0.5 + 0.2 * Math.sin(t * 0.9 + 1)} />
			<Glow x={m.W * (0.2 + 0.3 * Math.sin(t * 0.27 + 4))} y={m.H * (-0.02 + 0.08 * Math.sin(t * 0.6))} r={D * 0.3} color={b} core="#FFF6E0" opacity={0.65 + 0.3 * Math.sin(t * 1.1 + 3)} />
			<AbsoluteFill style={{ background: `linear-gradient(112deg, transparent ${(sweep - 0.5) * 100}%, ${b}55 ${(sweep - 0.3) * 100}%, #FFFFFF33 ${(sweep - 0.25) * 100}%, transparent ${(sweep - 0.05) * 100}%)` }} />
		</AbsoluteFill>
	);
};

/** A film burn: a hot spot flares from a corner over the whole frame and dies away (works as a cut). */
export const MgFilmBurn: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#FF5A1F");
	const b = col(p.color2, "#FFE7A3");
	const from = str(p.from, "right");
	const g = Math.sin(Math.PI * clamp(m.life, 0, 1)) ** 1.4;
	const D = Math.hypot(m.W, m.H);
	const ox = from === "left" ? 0 : from === "center" ? m.W / 2 : m.W;
	const oy = from === "center" ? m.H / 2 : m.H * 0.15;
	const flicker = (0.85 + 0.15 * random(`fb-${Math.floor(m.f / 2)}`)) * clamp(num(p.intensity, 1), 0.2, 1);
	return (
		<AbsoluteFill style={{ overflow: "hidden", mixBlendMode: "screen", opacity: flicker }}>
			{Array.from({ length: 8 }, (_, i) => i).map((i) => {
				const r = (key: string) => random(`fb-${key}-${i}`);
				const ang = r("a") * Math.PI * 2;
				const dist = D * 0.22 * r("d") * (0.4 + g);
				const jitter = Math.sin(m.sec * (3 + r("f") * 4) + i) * 30 * m.u;
				return <Glow key={i} x={ox + Math.cos(ang) * dist + jitter} y={oy + Math.sin(ang) * dist} r={D * (0.12 + 0.75 * g) * (0.55 + 0.6 * r("s"))} color={i % 3 === 0 ? "#B3200A" : a} core={b} opacity={clamp(g * 1.4, 0, 1)} />;
			})}
			<AbsoluteFill style={{ background: b, opacity: clamp((g - 0.8) * 2.5, 0, 0.45) }} />
		</AbsoluteFill>
	);
};

/** An anamorphic lens flare: the light source drifts, a long streak, a halo, rays and ghosts mirrored through the centre. */
export const MgLensFlare: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#7FC8FF");
	const b = col(p.color2, "#FFD9A0");
	const k = clamp(num(p.intensity, 0.9), 0.1, 1);
	const drift = num(p.drift, 0.15);
	const sx = m.W * (clamp(num(p.x, 0.22), 0, 1) + drift * m.life);
	const sy = m.H * (clamp(num(p.y, 0.22), 0, 1) + drift * 0.35 * m.life);
	const cx = m.W / 2;
	const cy = m.H / 2;
	const short = Math.min(m.W, m.H);
	const pulse = 0.92 + 0.08 * Math.sin(m.sec * 9) * random(`lf-${Math.floor(m.f / 3)}`);
	const ghosts: [number, number, string][] = [
		[0.45, 0.05, b],
		[0.75, 0.025, a],
		[1.25, 0.09, a],
		[1.55, 0.035, b],
		[1.9, 0.14, "#B98CFF"],
	];
	return (
		<AbsoluteFill style={{ opacity: m.at(0, 0.6) * m.out * k * pulse, overflow: "hidden", mixBlendMode: "screen" }}>
			<Glow x={sx} y={sy} r={short * 0.6} color={b} core="#FFFFFF" opacity={0.9} />
			<Glow x={sx} y={sy} r={short * 0.12} color="#FFFFFF" />
			<div style={{ position: "absolute", left: sx - short * 0.3, top: sy - short * 0.3, width: short * 0.6, height: short * 0.6, borderRadius: "50%", rotate: `${m.sec * 6}deg`, background: `repeating-conic-gradient(from 0deg, #FFFFFF2a 0deg 1.5deg, transparent 1.5deg 11deg)`, maskImage: "radial-gradient(circle, black 0%, transparent 70%)", WebkitMaskImage: "radial-gradient(circle, black 0%, transparent 70%)" }} />
			<div style={{ position: "absolute", left: sx - m.W * 0.9, top: sy - 3 * m.u, width: m.W * 1.8, height: 8 * m.u, background: `linear-gradient(90deg, transparent, ${a}aa 30%, #FFFFFF 50%, ${a}aa 70%, transparent)` }} />
			<div style={{ position: "absolute", left: sx - m.W * 0.6, top: sy - 24 * m.u, width: m.W * 1.2, height: 48 * m.u, background: `radial-gradient(ellipse at center, ${a}44 0%, transparent 70%)` }} />
			<div style={{ position: "absolute", left: sx - short * 0.22, top: sy - short * 0.22, width: short * 0.44, height: short * 0.44, borderRadius: "50%", border: `${3 * m.u}px solid ${a}33`, boxShadow: `0 0 ${30 * m.u}px ${a}22, inset 0 0 ${30 * m.u}px ${a}22` }} />
			{ghosts.map(([t, r, c]) => (
				<div key={t} style={{ position: "absolute", left: sx + (cx - sx) * t * 2 - short * r, top: sy + (cy - sy) * t * 2 - short * r, width: short * r * 2, height: short * r * 2, borderRadius: "50%", background: `radial-gradient(circle, ${c}10 0%, ${c}30 60%, ${c}66 68%, transparent 72%)` }} />
			))}
		</AbsoluteFill>
	);
};

/** Old film: fine grain boiling every frame, dust and hairs, a scratch now and then, a warm cast and a vignette. */
export const MgGrain: React.FC<MP> = (p) => {
	const m = useMg(p);
	const k = clamp(num(p.amount, 0.35), 0, 1);
	const ink = col(p.ink, "#FFFFFF");
	const id = ids(p, "grain");
	const step = Math.floor(m.f / 2);
	const vig = clamp(num(p.vignette, 0.45), 0, 1);
	return (
		<AbsoluteFill style={{ opacity: m.at(0, 0.4) * m.out, overflow: "hidden" }}>
			<AbsoluteFill style={{ background: col(p.accent, "#FFB347"), opacity: clamp(num(p.tint, 0.12), 0, 0.5) }} />
			{k > 0 && (
				<svg aria-hidden="true" width={m.W} height={m.H} style={{ position: "absolute", inset: 0 }}>
					<filter id={id} x="0" y="0" width="100%" height="100%">
						<feTurbulence type="fractalNoise" baseFrequency={0.75} numOctaves={2} seed={m.f % 97} stitchTiles="stitch" result="n" />
						<feColorMatrix in="n" type="matrix" values={`0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${5 * k} 0 0 0 ${-2.5 * k}`} result="w" />
						<feColorMatrix in="n" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${-5 * k} 0 0 0 ${2.5 * k}`} result="b" />
						<feMerge>
							<feMergeNode in="w" />
							<feMergeNode in="b" />
						</feMerge>
					</filter>
					<rect width="100%" height="100%" filter={`url(#${id})`} />
				</svg>
			)}
			{p.dust !== false &&
				Array.from({ length: 9 }, (_, i) => i).map((i) => {
					const r = (key: string) => random(`gr-${key}-${step}-${i}`);
					if (r("on") > 0.45) return null;
					const hair = r("h") < 0.35;
					const s = (hair ? 60 + r("s") * 90 : 4 + r("s") * 12) * m.u;
					return <div key={i} style={{ position: "absolute", left: r("x") * m.W, top: r("y") * m.H, width: s, height: hair ? 3 * m.u : s * (0.6 + r("e") * 0.6), borderRadius: hair ? 999 : "50%", rotate: `${r("r") * 180}deg`, background: hair ? ink : r("c") < 0.5 ? "#000000" : ink, opacity: 0.35 + r("o") * 0.4 }} />;
				})}
			{p.dust !== false && random(`sc-${Math.floor(m.f / 5)}`) < 0.5 && <div style={{ position: "absolute", top: 0, bottom: 0, left: random(`scx-${Math.floor(m.f / 5)}`) * m.W, width: 2 * m.u, background: `linear-gradient(180deg, transparent, ${ink}88 20%, ${ink}55 70%, transparent)` }} />}
			<AbsoluteFill style={{ background: "#000000", opacity: 0.02 + 0.06 * random(`fl-${step}`) }} />
			<AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,${vig}) 100%)` }} />
		</AbsoluteFill>
	);
};

/** An old CRT screen: scanlines, an RGB mask, a rolling bright band, flicker, a curved dark bezel and a channel label. */
export const MgCrt: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#7CFFB2");
	const s = clamp(num(p.scan, 0.35), 0, 0.9);
	const line = Math.max(2, 3 * m.u);
	const roll = ((m.sec * 0.35) % 1.3) - 0.15;
	const label = str(p.label, "CH 03");
	return (
		<AbsoluteFill style={{ opacity: m.at(0, 0.3) * m.out * (0.94 + 0.06 * random(`crt-${m.f}`)), overflow: "hidden" }}>
			<AbsoluteFill style={{ background: `repeating-linear-gradient(0deg, rgba(0,0,0,${s}) 0px, rgba(0,0,0,${s}) ${line}px, transparent ${line}px, transparent ${line * 2.4}px)` }} />
			<AbsoluteFill style={{ background: `repeating-linear-gradient(90deg, rgba(255,40,40,0.07) 0 ${line}px, rgba(40,255,90,0.07) ${line}px ${line * 2}px, rgba(60,90,255,0.07) ${line * 2}px ${line * 3}px)` }} />
			<AbsoluteFill style={{ background: a, opacity: 0.07 }} />
			{p.roll !== false && <div style={{ position: "absolute", left: 0, right: 0, top: `${roll * 100}%`, height: "14%", background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.09), transparent)" }} />}
			{p.bezel !== false && <AbsoluteFill style={{ borderRadius: 70 * m.u, boxShadow: `0 0 0 ${200 * m.u}px #050505, inset 0 0 ${160 * m.u}px rgba(0,0,0,0.85)` }} />}
			{label && <div style={{ position: "absolute", top: m.H * 0.08, right: m.W * 0.08, fontFamily: fontOf(p, "Rubik"), fontWeight: 700, fontSize: 64 * m.u, color: a, textShadow: `0 0 ${12 * m.u}px ${a}, 0 0 ${2 * m.u}px ${a}` }}>{label}</div>}
		</AbsoluteFill>
	);
};

/** Rain: slanted streaks falling at three depths over a darker, colder frame; optional lightning. */
export const MgRain: React.FC<MP> = (p) => {
	const m = useMg(p);
	const n = count(p, 260, 500);
	const c = col(p.accent, "#CFE6FF");
	const ang = clamp(num(p.angle, 12), -40, 40);
	const tan = Math.tan((ang * Math.PI) / 180);
	const speed = clamp(num(p.speed, 1), 0.2, 3);
	const flash = p.lightning === true ? Math.max(0, ...[1.1, 3.3].map((t) => (m.sec > t && m.sec < t + 0.35 ? (1 - (m.sec - t) / 0.35) * (random(`lt-${Math.floor(m.f / 2)}`) > 0.3 ? 1 : 0.4) : 0))) : 0;
	return (
		<AbsoluteFill style={{ opacity: m.at(0, 0.5) * m.out, overflow: "hidden" }}>
			<AbsoluteFill style={{ background: "#0A1424", opacity: clamp(num(p.darken, 0.25), 0, 0.8) }} />
			{Array.from({ length: n }, (_, i) => i).map((i) => {
				const r = (key: string) => random(`rn-${key}-${i}`);
				const z = r("z");
				const len = mix(40, 140, z) * m.u;
				const v = mix(1400, 2600, z) * m.u * speed;
				const span = m.H + len * 2;
				const y = ((r("y") * span + m.sec * v) % span) - len;
				const x = r("x") * (m.W + Math.abs(tan) * m.H) - (tan > 0 ? tan * m.H : 0) + tan * y;
				return <div key={i} style={{ position: "absolute", left: x, top: y, width: mix(1.5, 4, z) * m.u, height: len, borderRadius: 999, rotate: `${-ang}deg`, background: `linear-gradient(180deg, transparent, ${c})`, opacity: mix(0.35, 0.9, z) }} />;
			})}
			{flash > 0 && <AbsoluteFill style={{ background: "#EAF3FF", opacity: flash * 0.7 }} />}
		</AbsoluteFill>
	);
};

// ───────────── Particles ─────────────

/** Fireworks: rockets climb with a trail and burst into glowing shells that fall and twinkle out. */
export const MgFireworks: React.FC<MP> = (p) => {
	const m = useMg(p);
	const B = clamp(Math.round(num(p.bursts, 5)), 1, 10);
	const palette = [col(p.accent, "#FFD23F"), col(p.color2, "#FF3D71"), col(p.color3, "#22D3EE"), "#A3FF6B", "#FFFFFF"];
	const short = Math.min(m.W, m.H);
	const rise = 0.7;
	const nodes: React.ReactNode[] = [];
	for (let b = 0; b < B; b++) {
		const r = (key: string) => random(`fw-${key}-${b}`);
		const t0 = (b / B) * Math.max(0.6, m.L - 2) + r("t") * 0.3;
		const bx = m.W * (0.18 + 0.64 * r("x"));
		const by = m.H * (m.shape === "tall" ? 0.16 + 0.3 * r("y") : 0.14 + 0.3 * r("y"));
		const color = palette[b % palette.length];
		const t = m.sec - t0;
		if (t < 0) continue;
		if (t < rise) {
			const k = E.out(t / rise);
			const y = mix(m.H * 1.02, by, k);
			nodes.push(<div key={`r${b}`} style={{ position: "absolute", left: bx - 3 * m.u, top: y, width: 6 * m.u, height: 90 * m.u, borderRadius: 999, background: `linear-gradient(180deg, #FFFFFF, ${color}88, transparent)` }} />);
			continue;
		}
		const tau = t - rise;
		if (tau > 2.2) continue;
		const R = short * (0.3 + 0.15 * r("R"));
		const n = 84;
		nodes.push(<div key={`f${b}`} style={{ position: "absolute", left: bx - R * 0.6, top: by - R * 0.6, width: R * 1.2, height: R * 1.2, borderRadius: "50%", background: `radial-gradient(circle, ${color}88, transparent 70%)`, opacity: Math.max(0, 1 - tau * 3) }} />);
		for (let i = 0; i < n; i++) {
			const q = (key: string) => random(`fp-${key}-${b}-${i}`);
			const ang = (i / n) * Math.PI * 2 + q("a") * 0.2;
			const v = R * (0.75 + 0.25 * q("v"));
			const k = 1 - Math.exp(-3.2 * tau);
			const x = bx + Math.cos(ang) * v * k;
			const y = by + Math.sin(ang) * v * k + 0.5 * short * 0.22 * tau * tau;
			const fade = clamp(1 - (tau / 2.2) ** 2, 0, 1);
			const tw = tau > 1.4 ? (q(`w${Math.floor(m.f / 2)}`) > 0.4 ? 1 : 0.35) : 1;
			const len = (40 * (1 - k) + 10) * m.u;
			nodes.push(<div key={`p${b}-${i}`} style={{ position: "absolute", left: x, top: y, width: len, height: 8 * m.u, borderRadius: 999, transformOrigin: "0 50%", rotate: `${(ang * 180) / Math.PI + 180}deg`, background: `linear-gradient(90deg, #FFFFFF, ${color} 35%, transparent)`, opacity: fade * tw, boxShadow: `0 0 ${10 * m.u}px ${color}` }} />);
		}
	}
	return <AbsoluteFill style={{ opacity: m.out, overflow: "hidden", mixBlendMode: "screen" }}>{nodes}</AbsoluteFill>;
};

const HEART = "M12 21.3l-1.4-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.5L12 21.3z";

/** Hearts floating up like live reactions: along the right edge or over the whole frame, swaying and fading. */
export const MgHearts: React.FC<MP> = (p) => {
	const m = useMg(p);
	const n = count(p, 36, 120);
	const palette = [col(p.accent, "#FF3D71"), col(p.color2, "#FF8FB1"), "#FFFFFF", "#FF9F0A"];
	const full = str(p.side, "right") === "full";
	const life = 2.6;
	return (
		<AbsoluteFill style={{ opacity: m.out, overflow: "hidden" }}>
			{Array.from({ length: n }, (_, i) => i).map((i) => {
				const r = (key: string) => random(`ht-${key}-${i}`);
				const t = m.sec - (i / n) * Math.max(0.5, m.L - 1) - r("d") * 0.3;
				if (t < 0 || t > life) return null;
				const size = mix(50, 110, r("s")) * m.u;
				const x0 = full ? r("x") * m.W : m.W - (m.shape === "tall" ? 150 : 170) * m.u - r("x") * 60 * m.u;
				const x = x0 + Math.sin(t * (2 + r("f") * 2) + r("p") * 6) * 45 * m.u * Math.min(1, t);
				const y = (full ? m.H * 1.05 : m.H * (m.shape === "tall" ? 0.8 : 0.88)) - t * (full ? m.H * 0.45 : m.H * 0.22) * (0.8 + 0.4 * r("v"));
				const pop = E.back(Math.min(1, t / 0.3));
				const fade = 1 - clamp((t - life * 0.55) / (life * 0.45), 0, 1);
				return (
					<svg aria-hidden="true" key={i} width={size} height={size} viewBox="0 0 24 24" style={{ position: "absolute", left: x - size / 2, top: y - size / 2, scale: String(pop), opacity: fade, rotate: `${(r("r") - 0.5) * 30}deg`, filter: `drop-shadow(0 ${2 * m.u}px ${6 * m.u}px rgba(0,0,0,0.3))` }}>
						<path d={HEART} fill={palette[i % palette.length]} />
					</svg>
				);
			})}
		</AbsoluteFill>
	);
};

/** Soap bubbles drifting up with a wobble: clear centres, an iridescent rim and a highlight. */
export const MgBubbles: React.FC<MP> = (p) => {
	const m = useMg(p);
	const n = count(p, 26, 80);
	const a = col(p.accent, "#8FE3FF");
	const b = col(p.color2, "#FF9CEB");
	const speed = clamp(num(p.speed, 1), 0.2, 3);
	return (
		<AbsoluteFill style={{ opacity: m.at(0, 0.6) * m.out, overflow: "hidden" }}>
			{Array.from({ length: n }, (_, i) => i).map((i) => {
				const r = (key: string) => random(`bb-${key}-${i}`);
				const size = mix(50, 200, r("s") ** 1.5) * m.u;
				const span = m.H + size * 2;
				const y = m.H + size - ((r("y") * span + m.sec * mix(120, 260, r("v")) * m.u * speed) % span);
				const x = r("x") * m.W + Math.sin(m.sec * (0.8 + r("f")) + r("p") * 6) * 50 * m.u;
				const wob = Math.sin(m.sec * 5 + r("w") * 6) * 0.04;
				return (
					<div
						key={i}
						style={{
							position: "absolute",
							left: x - size / 2,
							top: y - size / 2,
							width: size,
							height: size,
							borderRadius: "50%",
							scale: `${1 + wob} ${1 - wob}`,
							background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.95) 0 4%, transparent 10%), radial-gradient(circle, transparent 56%, ${a}40 64%, ${b}99 70%, rgba(255,255,255,0.8) 72.5%, transparent 74%)`,
						}}
					/>
				);
			})}
		</AbsoluteFill>
	);
};

// ───────────── Stingers (cover the cut) ─────────────

/** A glitch hit: colour slices, shifted blocks and noise peak in the middle (covering the cut), with an optional word. */
export const MgGlitch: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#00E5FF");
	const b = col(p.color2, "#FF2D78");
	const k = clamp(num(p.intensity, 1), 0.2, 1.5);
	const e = Math.sin(Math.PI * clamp(m.life, 0, 1)) ** 0.8;
	const step = Math.floor(m.f / 2);
	const label = str(p.label);
	const palette = [a, b, "#FFFFFF", "#000000", "#14141A"];
	const cover = clamp((e - 0.72) * 4, 0, 1);
	const fs = label ? fitP(p, label, m.W * 0.8, 220 * m.u) : 0;
	return (
		<AbsoluteFill style={{ overflow: "hidden" }}>
			<AbsoluteFill style={{ background: "#07070B", opacity: cover }} />
			{Array.from({ length: Math.round(14 * k) }, (_, i) => i).map((i) => {
				const r = (key: string) => random(`gl-${key}-${step}-${i}`);
				if (r("on") > e) return null;
				const h = mix(6, 90, r("h") ** 2) * m.u;
				const w = m.W * mix(0.25, 1.1, r("w"));
				return <div key={i} style={{ position: "absolute", top: r("y") * m.H, left: (r("x") - 0.2) * m.W, width: w, height: h, background: palette[Math.floor(r("c") * palette.length)], opacity: 0.55 + 0.45 * r("o"), mixBlendMode: i % 2 ? "screen" : "normal" }} />;
			})}
			{Array.from({ length: Math.round(24 * k) }, (_, i) => i).map((i) => {
				const r = (key: string) => random(`gn-${key}-${step}-${i}`);
				if (r("on") > e * 0.8) return null;
				const s = mix(12, 46, r("s")) * m.u;
				return <div key={`n${i}`} style={{ position: "absolute", left: r("x") * m.W, top: r("y") * m.H, width: s * 2, height: s, background: r("c") > 0.5 ? a : b, opacity: 0.8 }} />;
			})}
			{label && (
				<AbsoluteFill style={{ display: "grid", placeItems: "center", opacity: clamp(e * 2, 0, 1) }}>
					{[
						[b, -1],
						[a, 1],
						["#FFFFFF", 0],
					].map(([c, d]) => (
						<div key={String(c)} style={{ position: "absolute", fontFamily: fontOf(p, "Unbounded"), fontWeight: 900, fontSize: fs, color: String(c), translate: `${Number(d) * 14 * m.u * e + (random(`gx-${step}`) - 0.5) * 30 * m.u * e}px ${Number(d) * 4 * m.u}px`, mixBlendMode: d === 0 ? "normal" : "screen", letterSpacing: "0.02em" }}>
							{label}
						</div>
					))}
				</AbsoluteFill>
			)}
		</AbsoluteFill>
	);
};

/** Shutter blinds: slats close one after another over the cut, hold a beat (with an optional word), then open. */
export const MgShutter: React.FC<MP> = (p) => {
	const m = useMg(p);
	const n = clamp(Math.round(num(p.slats, 8)), 3, 24);
	const a = col(p.accent, "#111111");
	const vertical = str(p.direction, "horizontal") === "vertical";
	const label = str(p.label);
	const half = m.L / 2;
	return (
		<AbsoluteFill style={{ overflow: "hidden", display: "flex", flexDirection: vertical ? "row" : "column" }}>
			{Array.from({ length: n }, (_, i) => i).map((i) => {
				const lag = (i / n) * Math.min(0.3, half * 0.4);
				const close = E.inOut(clamp((m.sec - lag) / Math.max(0.15, half * 0.55), 0, 1));
				const open = E.inOut(clamp((m.sec - half - 0.05 - lag) / Math.max(0.15, half * 0.55), 0, 1));
				const s = close * (1 - open);
				return <div key={i} style={{ flex: 1, background: `linear-gradient(${vertical ? 90 : 180}deg, ${a}, ${a}dd)`, scale: vertical ? `${s} 1` : `1 ${s}`, transformOrigin: i % 2 ? (vertical ? "100% 50%" : "50% 100%") : vertical ? "0 50%" : "50% 0", boxShadow: "inset 0 -2px 0 rgba(255,255,255,0.06)" }} />;
			})}
			{label && (
				<AbsoluteFill style={{ display: "grid", placeItems: "center" }}>
					<div style={{ fontFamily: fontOf(p, "Montserrat"), fontWeight: 900, fontSize: fitP(p, label, m.W * 0.8, 170 * m.u), color: col(p.ink, "#FFFFFF"), opacity: clamp((m.sec - half * 0.55) / 0.15, 0, 1) * clamp((half + 0.1 - m.sec) / 0.12, 0, 1), letterSpacing: "0.04em" }}>{label}</div>
				</AbsoluteFill>
			)}
		</AbsoluteFill>
	);
};

/** A liquid wipe: two wavy colour bands surge up over the frame and run off the top. */
export const MgLiquidWipe: React.FC<MP> = (p) => {
	const m = useMg(p);
	const a = col(p.accent, "#c98a1e");
	const b = col(p.color2, "#22D3EE");
	const label = str(p.label);
	const amp = Math.min(m.W, m.H) * 0.06;
	const band = (lag: number, color: string) => {
		const t = E.inOut(clamp((m.life - lag) / 0.82, 0, 1));
		const top = mix(m.H + amp * 2, -m.H * 1.5, t);
		const bottom = top + m.H * 1.5;
		const wave = (y0: number, phase: number) =>
			Array.from({ length: 33 }, (_, i) => i).map((i) => {
				const x = (i / 32) * m.W;
				return `${x.toFixed(1)},${(y0 + Math.sin((i / 32) * Math.PI * 3 + m.sec * 5 + phase) * amp).toFixed(1)}`;
			});
		const up = wave(top, lag * 10);
		const down = wave(bottom, lag * 10 + 2).reverse();
		return <polygon key={color} points={[...up, ...down].join(" ")} fill={color} />;
	};
	const show = clamp((m.life - 0.32) / 0.06, 0, 1) * clamp((0.62 - m.life) / 0.06, 0, 1);
	return (
		<AbsoluteFill>
			<svg aria-hidden="true" width={m.W} height={m.H} style={{ position: "absolute", inset: 0 }}>
				{band(0, b)}
				{band(0.08, a)}
			</svg>
			{label && (
				<AbsoluteFill style={{ display: "grid", placeItems: "center", opacity: show }}>
					<div style={{ fontFamily: fontOf(p, "Unbounded"), fontWeight: 900, fontSize: fitP(p, label, m.W * 0.8, 160 * m.u), color: col(p.ink, "#FFFFFF"), scale: String(mix(0.9, 1, show)) }}>{label}</div>
				</AbsoluteFill>
			)}
		</AbsoluteFill>
	);
};

// Particle overlays: confetti, sparks, snow, bokeh. Every particle is a pure function of the frame and its seed
// (remotion `random`), so a frame looks the same in the player, on a scrub and in the export.
import type React from "react";
import { AbsoluteFill, random } from "remotion";
import { col, mix, type MP, num, str, useMg } from "./base";

const amount = (p: MP, d: number, max: number) => Math.max(4, Math.min(max, Math.round(num(p.amount, d))));

/** Confetti raining from the top, or bursting from the centre and falling under gravity, fluttering as it goes. */
export const MgConfetti: React.FC<MP> = (p) => {
	const m = useMg(p);
	const n = amount(p, 160, 300);
	const palette = [col(p.accent, "#FFD23F"), col(p.color2, "#FF3D71"), col(p.color3, "#22D3EE"), "#FFFFFF", "#f0bd6a"];
	const burst = str(p.mode, "burst") === "burst";
	const g = m.H * 1.1;
	return (
		<AbsoluteFill style={{ opacity: m.out, overflow: "hidden" }}>
			{Array.from({ length: n }, (_, i) => i).map((i) => {
				const r = (k: string) => random(`cf-${k}-${i}`);
				let x: number;
				let y: number;
				if (burst) {
					const t = m.sec - r("d") * 0.15;
					if (t < 0) return null;
					const ang = -Math.PI / 2 + (r("a") - 0.5) * Math.PI * 1.1;
					const v = m.H * (0.9 + r("v") * 1.1);
					const drag = Math.exp(-t * 1.4);
					x = m.W / 2 + Math.cos(ang) * v * (1 - drag) * 0.7 + Math.sin(t * 6 + r("p") * 6) * 20 * m.u;
					y = m.H * 0.55 + Math.sin(ang) * v * (1 - drag) * 0.7 + 0.5 * g * 0.35 * t * t;
				} else {
					const t = m.sec - r("d") * Math.max(0.5, m.L * 0.6);
					if (t < 0) return null;
					x = r("x") * m.W + Math.sin(t * (2 + r("f") * 2) + r("p") * 6) * 40 * m.u;
					y = -40 * m.u + t * m.H * (0.22 + r("v") * 0.25);
				}
				if (y > m.H + 40 * m.u) return null;
				const w = (16 + r("w") * 14) * m.u;
				const round = r("s") < 0.25;
				return (
					<div
						key={i}
						style={{ position: "absolute", left: x, top: y, width: w, height: round ? w : w * 1.7, borderRadius: round ? "50%" : 2 * m.u, background: palette[i % palette.length], transform: `rotate(${m.sec * (200 + r("r") * 400) * (i % 2 ? 1 : -1)}deg) rotateX(${m.sec * (300 + r("q") * 300)}deg)` }}
					/>
				);
			})}
		</AbsoluteFill>
	);
};

/** Sparks flying up from the bottom on curved paths, bright heads with fading tails. */
export const MgSparks: React.FC<MP> = (p) => {
	const m = useMg(p);
	const n = amount(p, 140, 260);
	const a = col(p.accent, "#FFB020");
	const b = col(p.color2, "#FFF3B0");
	return (
		<AbsoluteFill style={{ opacity: m.out, overflow: "hidden", mixBlendMode: "screen" }}>
			{Array.from({ length: n }, (_, i) => i).map((i) => {
				const r = (k: string) => random(`sp-${k}-${i}`);
				const life = 0.8 + r("l") * 0.9;
				const born = r("b") * Math.max(0.5, m.L - 0.4);
				const t = m.sec - born;
				if (t < 0 || t > life) return null;
				const x0 = m.W * (0.15 + r("x") * 0.7);
				const vx = (r("vx") - 0.5) * m.W * 0.5;
				const vy = -m.H * (0.55 + r("vy") * 0.6);
				const gy = m.H * 0.6;
				const x = x0 + vx * t;
				const y = m.H * 1.02 + vy * t + 0.5 * gy * t * t;
				const ang = Math.atan2(vy + gy * t, vx);
				const fade = 1 - t / life;
				const len = (40 + r("s") * 50) * m.u;
				return <div key={i} style={{ position: "absolute", left: x, top: y, width: len, height: 6 * m.u, borderRadius: 3 * m.u, background: `linear-gradient(90deg, ${b}, ${a} 40%, transparent)`, transform: `rotate(${(ang * 180) / Math.PI + 180}deg)`, transformOrigin: "0 50%", opacity: fade, boxShadow: `0 0 ${8 * m.u}px ${a}` }} />;
			})}
		</AbsoluteFill>
	);
};

/** Snow drifting down with a sway; nearer flakes are bigger, faster and brighter. */
export const MgSnow: React.FC<MP> = (p) => {
	const m = useMg(p);
	const n = amount(p, 140, 320);
	const c = col(p.accent, "#FFFFFF");
	return (
		<AbsoluteFill style={{ opacity: m.at(0, 0.6) * m.out, overflow: "hidden" }}>
			{Array.from({ length: n }, (_, i) => i).map((i) => {
				const r = (k: string) => random(`sn-${k}-${i}`);
				const depth = r("z");
				const size = mix(6, 26, depth) * m.u;
				const speed = mix(50, 190, depth) * m.u * num(p.speed, 1);
				const span = m.H + 60 * m.u;
				const y = ((r("y") * span + m.sec * speed) % span) - 30 * m.u;
				const x = r("x") * m.W + Math.sin(m.sec * (0.8 + r("f")) + r("p") * 6) * 30 * m.u * (0.4 + depth);
				return <div key={i} style={{ position: "absolute", left: x, top: y, width: size, height: size, borderRadius: "50%", background: `radial-gradient(circle, ${c} 0%, ${c}cc 45%, transparent 72%)`, opacity: mix(0.45, 1, depth) }} />;
			})}
		</AbsoluteFill>
	);
};

/** Soft out-of-focus lights drifting and breathing (screen blend over the video). */
export const MgBokeh: React.FC<MP> = (p) => {
	const m = useMg(p);
	const n = amount(p, 28, 80);
	const palette = [col(p.accent, "#FFD27A"), col(p.color2, "#FF8FB1"), col(p.color3, "#8FD3FF")];
	return (
		<AbsoluteFill style={{ opacity: m.at(0, 0.8) * m.out, overflow: "hidden", mixBlendMode: "screen" }}>
			{Array.from({ length: n }, (_, i) => i).map((i) => {
				const r = (k: string) => random(`bk-${k}-${i}`);
				const size = mix(80, 300, r("s")) * m.u;
				const c = palette[i % palette.length];
				const x = r("x") * m.W + Math.sin(m.sec * 0.3 + r("p") * 6) * 60 * m.u;
				const y = r("y") * m.H + Math.cos(m.sec * 0.25 + r("q") * 6) * 50 * m.u - m.sec * 12 * m.u;
				const breathe = 0.45 + 0.35 * Math.sin(m.sec * (0.8 + r("b")) + r("o") * 6);
				return <div key={i} style={{ position: "absolute", left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: "50%", background: `radial-gradient(circle, ${c}66 0%, ${c}44 55%, ${c}99 64%, transparent 70%)`, opacity: breathe }} />;
			})}
		</AbsoluteFill>
	);
};
